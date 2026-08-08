import { For, Show, createEffect, createMemo, createSignal } from 'solid-js'
import type {
  Config,
  TrackerGroupDetail,
  TrackerGroupSuggestion,
  UploadFlowStateJSON,
  UploadTrackerId
} from '@shared/types'
import { enabledTrackerOptions } from '@shared/config/trackers'
import { parseTorrentPageRef } from '@shared/upload/dupeSearch'
import {
  groupIdForTracker,
  withGroupIdForTracker
} from '@shared/upload/groupIds'
import { stepIndexOf } from '@shared/upload/stepGating'
import { formatByteSize } from '@shared/format'
import { Badge, Button, Callout, Card, Icon, IconButton } from '../../ui'
import { TrackerIcon, trackerLabel } from '../../components/TrackerIcon'

function formatGroupTitle(s: {
  artist: string
  groupName: string
  year?: number
}): string {
  const artist = s.artist.trim() || 'Unknown artist'
  const album = s.groupName.trim() || 'Untitled'
  const year = s.year ? ` (${s.year})` : ''
  return `${artist} – ${album}${year}`
}

function formatSuggestionMeta(s: TrackerGroupSuggestion): string {
  const parts: string[] = []
  if (s.releaseType) parts.push(String(s.releaseType))
  if (s.tags.length > 0) parts.push(s.tags.slice(0, 6).join(', '))
  return parts.join(' · ')
}

function formatTorrentLine(t: TrackerGroupDetail['torrents'][number]): string {
  const parts = [t.media, t.format, t.encoding].filter(Boolean)
  const remasterBits = [
    t.remasterYear ? String(t.remasterYear) : '',
    t.remasterTitle ?? '',
    t.remasterRecordLabel ?? '',
    t.remasterCatalogueNumber ?? ''
  ].filter(Boolean)
  if (remasterBits.length > 0) parts.push(remasterBits.join(' / '))
  if (t.size != null) parts.push(formatByteSize(t.size))
  return parts.join(' · ') || 'Torrent'
}

function TrackerGroupPanel(props: {
  trackerId: UploadTrackerId
  state: UploadFlowStateJSON
  results: TrackerGroupSuggestion[]
  status: string | undefined
}) {
  const upload = () => props.state.upload
  const groupId = () => groupIdForTracker(upload(), props.trackerId)
  const [manualInput, setManualInput] = createSignal('')
  const [manualError, setManualError] = createSignal('')
  const [detail, setDetail] = createSignal<TrackerGroupDetail | null>(null)
  const [detailLoading, setDetailLoading] = createSignal(false)
  const [detailError, setDetailError] = createSignal('')
  const [showAll, setShowAll] = createSignal(false)

  const visibleResults = createMemo(() =>
    showAll() ? props.results : props.results.slice(0, 5)
  )
  const hiddenCount = createMemo(() => Math.max(0, props.results.length - 5))

  createEffect(() => {
    const id = groupId()
    if (id == null) {
      setDetail(null)
      setDetailError('')
      setDetailLoading(false)
      return
    }

    let cancelled = false
    setDetailLoading(true)
    setDetailError('')
    void window.gravlax.upload
      .fetchTorrentGroup(props.trackerId, id)
      .then((next) => {
        if (cancelled) return
        setDetail(next)
        setDetailLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setDetail(null)
        setDetailError(String((err as Error).message ?? err))
        setDetailLoading(false)
      })

    return () => {
      cancelled = true
    }
  })

  const patchGroupId = (nextGroupId: number | null): void => {
    void window.gravlax.upload.updateUploadReport({
      groupIds: withGroupIdForTracker(upload().groupIds, props.trackerId, nextGroupId)
    })
  }

  const selectNewGroup = (): void => {
    setManualInput('')
    setManualError('')
    patchGroupId(null)
  }

  const selectSuggestion = (suggestion: TrackerGroupSuggestion): void => {
    setManualInput('')
    setManualError('')
    patchGroupId(suggestion.groupId)
  }

  const applyManual = async (): Promise<void> => {
    setManualError('')
    const raw = manualInput().trim()
    if (!raw) {
      selectNewGroup()
      return
    }

    const parsed = parseTorrentPageRef(raw)
    if (!parsed) {
      setManualError('Enter a group ID or torrents.php URL.')
      return
    }

    if (parsed.groupId != null) {
      patchGroupId(parsed.groupId)
      return
    }

    if (parsed.torrentId != null) {
      try {
        const resolved = await window.gravlax.upload.resolveTorrentGroupId(
          props.trackerId,
          parsed.torrentId
        )
        if (resolved == null) {
          setManualError('Could not resolve group ID from torrent ID.')
          return
        }
        patchGroupId(resolved)
      } catch (err) {
        setManualError(String((err as Error).message ?? err))
      }
    }
  }

  return (
    <div class="group-suggestions-tracker">
      <div class="group-suggestions-tracker-header">
        <span class="group-suggestions-tracker-title">
          <TrackerIcon trackerId={props.trackerId} size={18} />
          <strong>{trackerLabel(props.trackerId)}</strong>
        </span>
        <Show when={groupId() != null}>
          <Badge tone="warning">Group #{groupId()}</Badge>
        </Show>
        <Show when={groupId() == null}>
          <Badge tone="info">New group</Badge>
        </Show>
      </div>

      <Card interactive selected={groupId() == null} onClick={selectNewGroup}>
        <div class="metadata-card-row">
          <div class="metadata-card-main">
            <div class="metadata-card-title">New group</div>
            <div class="metadata-card-desc">
              Create a new torrent group on {trackerLabel(props.trackerId)}.
            </div>
          </div>
          <Show when={groupId() == null}>
            <Icon name="check" size={16} class="metadata-check" />
          </Show>
        </div>
      </Card>

      <Show
        when={props.results.length > 0}
        fallback={
          <Show when={props.status === 'done'}>
            <div class="group-suggestions-empty">No matching groups found.</div>
          </Show>
        }
      >
        <For each={visibleResults()}>
          {(result) => {
            const selected = () => groupId() === result.groupId
            return (
              <div class="metadata-result-row">
                <Card
                  interactive
                  selected={selected()}
                  class="metadata-result-card"
                  onClick={() => selectSuggestion(result)}
                >
                  <div class="metadata-card-row">
                    <div class="metadata-card-main">
                      <div class="metadata-card-title">{formatGroupTitle(result)}</div>
                      <div class="metadata-card-desc">
                        <Show when={formatSuggestionMeta(result)}>
                          {(meta) => <span>{meta()}</span>}
                        </Show>
                      </div>
                      <div class="metadata-result-url mono">#{result.groupId}</div>
                    </div>
                    <Show when={selected()}>
                      <Icon name="check" size={16} class="metadata-check" />
                    </Show>
                  </div>
                </Card>
                <IconButton
                  icon="external-link"
                  label="Open group on tracker"
                  size="sm"
                  onClick={(event: MouseEvent) => {
                    event.stopPropagation()
                    void window.gravlax.shell.openExternal(result.url)
                  }}
                />
              </div>
            )
          }}
        </For>

        <Show when={hiddenCount() > 0 && !showAll()}>
          <button type="button" class="metadata-show-all" onClick={() => setShowAll(true)}>
            Show all {props.results.length} results
          </button>
        </Show>
        <Show when={showAll() && props.results.length > 5}>
          <button type="button" class="metadata-show-all" onClick={() => setShowAll(false)}>
            Show fewer
          </button>
        </Show>
      </Show>

      <Show when={groupId() != null}>
        <div class="group-suggestions-detail">
          <Show when={detail()}>
            {(d) => (
              <div class="group-suggestions-detail-title-row">
                <div class="group-suggestions-detail-title">{formatGroupTitle(d())}</div>
                <IconButton
                  icon="external-link"
                  label="Open group on tracker"
                  size="sm"
                  onClick={() => {
                    void window.gravlax.shell.openExternal(d().url)
                  }}
                />
              </div>
            )}
          </Show>
          <div class="group-suggestions-detail-heading">Existing torrents in group</div>
          <Show when={detailLoading()}>
            <div class="group-suggestions-empty">Loading group details…</div>
          </Show>
          <Show when={detailError()}>
            {(error) => <Callout tone="error">{error()}</Callout>}
          </Show>
          <Show when={detail()}>
            {(d) => (
              <div class="group-suggestions-torrents mono">
                <For
                  each={d().torrents}
                  fallback={<div class="group-suggestions-empty">No torrents listed.</div>}
                >
                  {(torrent) => <div>{formatTorrentLine(torrent)}</div>}
                </For>
              </div>
            )}
          </Show>
        </div>
      </Show>

      <div class="group-suggestions-manual">
        <label class="upload-report-field">
          <span>Group ID or URL</span>
          <input
            class="mono"
            type="text"
            value={manualInput()}
            placeholder="12345 or torrents.php?id=…"
            onInput={(e) => setManualInput(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void applyManual()
            }}
          />
        </label>
        <Button variant="secondary" onClick={() => void applyManual()}>
          Apply
        </Button>
      </div>
      <Show when={manualError()}>
        {(error) => <Callout tone="error">{error()}</Callout>}
      </Show>
    </div>
  )
}

export function GroupSuggestions(props: {
  state: UploadFlowStateJSON
  config: Config
}) {
  const upload = () => props.state.upload
  const groupSearch = () => upload().groupSearch

  const enabledTrackers = createMemo(() =>
    enabledTrackerOptions(props.config).filter(
      (id): id is UploadTrackerId => id === 'redacted' || id === 'orpheus'
    )
  )

  const destinationTrackers = createMemo(() => {
    const selected = (upload().selectedTrackerIds ?? []).filter(
      (id): id is UploadTrackerId => id === 'redacted' || id === 'orpheus'
    )
    return selected.filter((id) => enabledTrackers().includes(id))
  })

  const queryLabel = createMemo(() => {
    const strings = groupSearch()?.queryStrings ?? []
    if (strings.length === 0) return ''
    return strings.join(' · ')
  })

  const resultsFor = (trackerId: UploadTrackerId): TrackerGroupSuggestion[] =>
    (groupSearch()?.results ?? []).filter((r) => r.trackerId === trackerId)

  createEffect(() => {
    if (props.state.currentStep !== stepIndexOf('upload')) return
    void upload().title
    void upload().artists
    void upload().remasterCatalogueNumber
    void upload().selectedTrackerIds
    void enabledTrackers()
    if (!(upload().title ?? '').trim()) return
    if (destinationTrackers().length === 0 && enabledTrackers().length === 0) return
    void window.gravlax.upload.searchTrackerGroups()
  })

  const refresh = (): void => {
    void window.gravlax.upload.searchTrackerGroups({ force: true })
  }

  return (
    <Card class="upload-report-card group-suggestions-card">
      <div class="group-suggestions-header">
        <div>
          <div class="upload-report-heading">Existing groups</div>
          <Show when={queryLabel()}>
            <div class="group-suggestions-query mono">Matches for: {queryLabel()}</div>
          </Show>
        </div>
        <Button variant="secondary" onClick={refresh} disabled={destinationTrackers().length === 0}>
          Search again
        </Button>
      </div>

      <Show when={enabledTrackers().length === 0}>
        <Callout tone="warning">
          No trackers enabled. Enable Redacted and/or Orpheus in Settings → Trackers.
        </Callout>
      </Show>

      <Show when={enabledTrackers().length > 0 && destinationTrackers().length === 0}>
        <Callout tone="info">Select at least one destination above to choose groups.</Callout>
      </Show>

      <Show when={groupSearch()?.status === 'running' && destinationTrackers().length > 0}>
        <Callout tone="info">Searching trackers for matching groups…</Callout>
      </Show>

      <Show when={groupSearch()?.status === 'failed' && groupSearch()?.error}>
        {(error) => <Callout tone="error">{error()}</Callout>}
      </Show>

      <For each={destinationTrackers()}>
        {(trackerId) => (
          <TrackerGroupPanel
            trackerId={trackerId}
            state={props.state}
            results={resultsFor(trackerId)}
            status={groupSearch()?.status}
          />
        )}
      </For>
    </Card>
  )
}
