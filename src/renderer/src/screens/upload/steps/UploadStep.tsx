import { For, Index, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { Config } from '@shared/types/config'
import type {
  HealthResult,
  UploadFormatPayload,
  UploadSubmission,
  UploadTrackerId,
  UploadFlowStateJSON,
  Artist,
  UploadArtist
} from '@shared/types'
import { enabledTrackerOptions } from '@shared/config/trackers'
import { formatByteSize } from '@shared/format'
import { DEFAULT_ARTIST_ROLE } from '@shared/types/upload'
import {
  Badge,
  Button,
  Callout,
  Card,
  Icon,
  Section,
  Spinner,
  type BadgeTone
} from '../../../ui'
import { Modal } from '../../../components/Modal'
import { Select } from '../../../components/Select'
import { Toggle } from '../../../components/Toggle'
import { TrackerIcon, trackerLabel } from '../../../components/TrackerIcon'
import { ArtistsEditor, type ArtistEditAction } from '../ArtistsEditor'
import { spectralUrl } from '../pathUtil'
import { GroupSuggestions } from '../GroupSuggestions'
import { createBbcodePreviewBatcher } from '@shared/upload/bbcodePreviewBatcher'
import { anySelectedTrackerHasGroupId } from '@shared/upload/groupIds'
import {
  artistRoleToImportance,
  importanceToArtistRole
} from '@shared/upload/artists'
import { spectralDescriptionPreview } from '@shared/upload/spectralDescription'
import {
  effectiveReleaseType,
  isOrpheusSplitEligible,
  STANDARD_RELEASE_TYPES
} from '@shared/upload/releaseTypes'
import {
  derivedFieldMismatchMessage,
  derivedUploadFieldsFromTags,
  parseYear,
  type DerivedUploadFieldKey
} from '@shared/upload/derivedFields'
import {
  pendingUploadTrackerIds,
  validateTrackerHealth,
  validatePreparedUploadFormats,
  validateUploadReport,
  validateUploadTargets
} from '@shared/upload/validation'

const requestBbcodePreview = createBbcodePreviewBatcher((source) =>
  window.gravlax.upload.previewBbcode(source)
)

function displayOrEmpty(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  const text = String(value).trim()
  return text || '—'
}

function displayByteSize(value: number | null | undefined): string {
  return value == null ? '—' : formatByteSize(value)
}

function editorArtistsFromUpload(artists: UploadArtist[] | undefined): Artist[] {
  return (artists ?? []).map((artist) => ({
    name: artist.name,
    role: importanceToArtistRole(artist.importance)
  }))
}

function uploadArtistsFromEditor(artists: Artist[]): UploadArtist[] {
  return artists.map((artist) => ({
    name: artist.name ?? '',
    importance: artistRoleToImportance(artist.role)
  }))
}

function applyArtistEdit(artists: Artist[], action: ArtistEditAction): Artist[] {
  switch (action.type) {
    case 'name':
      return artists.map((artist, index) =>
        index === action.index ? { ...artist, name: action.name } : artist
      )
    case 'role':
      return artists.map((artist, index) =>
        index === action.index ? { ...artist, role: action.role } : artist
      )
    case 'remove':
      return artists.filter((_, index) => index !== action.index)
    case 'add':
      return [...artists, { name: '', role: DEFAULT_ARTIST_ROLE }]
  }
}

function TagMismatchNote(props: { message: string | null }) {
  return (
    <Show when={props.message}>
      {(message) => (
        <div class="upload-report-field-note upload-report-field-warning">{message()}</div>
      )}
    </Show>
  )
}

function uploadBlockedReason(
  state: UploadFlowStateJSON,
  config: Config,
  health: HealthResult | null,
  healthLoading: boolean
): string | null {
  const localError =
    validatePreparedUploadFormats(state) ??
    validateUploadReport(state.upload) ??
    validateUploadTargets(
      state.upload,
      config,
      pendingUploadTrackerIds(state.upload)
    )
  if (localError) return localError
  if (!health && healthLoading) return 'Waiting for tracker health checks to finish.'
  return validateTrackerHealth(health?.rows, pendingUploadTrackerIds(state.upload))
}

function BbcodeDescriptionField(props: {
  label: string
  value: string
  previewValue?: string
  rows: number
  badge?: 'groupId'
  onChange: (value: string) => void
}) {
  const [editing, setEditing] = createSignal(false)
  const [html, setHtml] = createSignal('')
  const [loading, setLoading] = createSignal(false)
  const [previewError, setPreviewError] = createSignal<string | null>(null)
  let lastSource: string | null = null
  let lastHtml = ''
  let requestGeneration = 0
  let disposed = false
  const previewSource = () => props.previewValue ?? props.value

  const requestPreview = (source: string, force = false): void => {
    if (!force && lastSource === source) {
      setHtml(lastHtml)
      setPreviewError(null)
      setLoading(false)
      return
    }

    const generation = ++requestGeneration
    if (source === '') {
      lastSource = source
      lastHtml = ''
      setHtml('')
      setPreviewError(null)
      setLoading(false)
      return
    }

    setLoading(true)
    setPreviewError(null)
    void requestBbcodePreview(source).then(
      (nextHtml) => {
        if (disposed || generation !== requestGeneration) return
        lastSource = source
        lastHtml = nextHtml
        setHtml(nextHtml)
        setLoading(false)
      },
      (error: unknown) => {
        if (disposed || generation !== requestGeneration) return
        const message = error instanceof Error ? error.message.trim() : String(error).trim()
        setPreviewError(message || 'Could not load the BBCode preview.')
        setLoading(false)
      }
    )
  }

  createEffect(() => {
    const source = previewSource()
    if (!editing()) requestPreview(source)
  })

  onCleanup(() => {
    disposed = true
    requestGeneration += 1
  })

  return (
    <div class="upload-report-field upload-report-field-full">
      <div class="upload-report-field-header">
        <span>
          {props.label}
          <Show when={props.badge === 'groupId'}>
            <Badge tone="warning">Ignored for destinations with a group ID</Badge>
          </Show>
        </span>
        <Button variant="secondary" onClick={() => setEditing((v) => !v)}>
          {editing() ? 'Show preview' : 'Edit'}
        </Button>
      </div>
      <Show
        when={editing()}
        fallback={
          <Show
            when={!loading()}
            fallback={
              <div class="upload-report-bbcode-state" aria-live="polite">
                <Spinner size="sm" />
                <span>Loading preview…</span>
              </div>
            }
          >
            <Show
              when={!previewError()}
              fallback={
                <Callout tone="warning">
                  <div class="upload-report-bbcode-error">
                    <span>{previewError()}</span>
                    <Button variant="secondary" onClick={() => requestPreview(previewSource(), true)}>
                      Retry
                    </Button>
                  </div>
                </Callout>
              }
            >
              <div class="mono upload-report-bbcode-preview" innerHTML={html()} />
            </Show>
          </Show>
        }
      >
        <textarea
          class="mono upload-report-textarea"
          rows={props.rows}
          value={props.value}
          onInput={(e) => props.onChange(e.currentTarget.value)}
        />
      </Show>
    </div>
  )
}

function formatFromCoverSource(source: string): string {
  const lower = source.toLowerCase()
  if (lower.includes('.jpg') || lower.includes('.jpeg')) return 'JPEG'
  if (lower.includes('.png')) return 'PNG'
  if (lower.includes('.webp')) return 'WebP'
  if (lower.includes('.gif')) return 'GIF'
  try {
    const ext = new URL(source).pathname.split('.').pop()?.toLowerCase() ?? ''
    if (ext === 'jpg' || ext === 'jpeg') return 'JPEG'
    if (ext === 'png') return 'PNG'
    if (ext === 'webp') return 'WebP'
    if (ext === 'gif') return 'GIF'
  } catch {
    /* ignore */
  }
  return 'Image'
}

function CoverImageField(props: {
  value: string
  coverPath?: string
  onChange: (value: string) => void
}) {
  const trimmed = createMemo(() => props.value.trim())
  const localPath = createMemo(() => (props.coverPath ?? '').trim())
  const previewSrc = createMemo(() => {
    const local = localPath()
    if (local) return spectralUrl(local)
    const url = trimmed()
    return url
  })
  const hasCoverReady = createMemo(() => previewSrc().length > 0)
  const [editing, setEditing] = createSignal(false)
  const [dimensions, setDimensions] = createSignal<{ w: number; h: number } | null>(null)
  const [byteSize, setByteSize] = createSignal<number | null>(null)
  const [loadFailed, setLoadFailed] = createSignal(false)

  createEffect((hadCover: boolean | undefined) => {
    const src = previewSrc()
    setDimensions(null)
    setByteSize(null)
    setLoadFailed(false)
    if (!src) {
      setEditing(false)
      return false
    }
    if (!hadCover) setEditing(false)

    const img = new Image()
    img.onload = () => {
      if (previewSrc() !== src) return
      setDimensions({ w: img.naturalWidth, h: img.naturalHeight })
      setLoadFailed(false)
    }
    img.onerror = () => {
      if (previewSrc() !== src) return
      setDimensions(null)
      setLoadFailed(true)
    }
    img.src = src

    void fetch(src)
      .then((res) => (res.ok ? res.blob() : null))
      .then((blob) => {
        if (previewSrc() !== src || !blob) return
        setByteSize(blob.size)
      })
      .catch(() => {
        /* size is optional */
      })

    return true
  })

  const showPreview = createMemo(() => hasCoverReady() && !editing() && !loadFailed())
  const meta = createMemo(() => {
    const dims = dimensions()
    const format = formatFromCoverSource(localPath() || trimmed())
    const size = byteSize()
    const sizeText = size != null ? formatByteSize(size) : null
    const parts = [
      dims ? `${dims.w}×${dims.h}` : null,
      format,
      sizeText
    ].filter(Boolean)
    return parts.join(' · ')
  })

  const openCover = (): void => {
    const local = localPath()
    if (local) {
      void window.gravlax.shell.openPath(local)
      return
    }
    const url = trimmed()
    if (url) void window.gravlax.shell.openExternal(url)
  }

  return (
    <div class="upload-report-field upload-report-field-full">
      <div class="upload-report-field-header">
        <span>Cover image</span>
      </div>
      <Show
        when={showPreview()}
        fallback={
          <div class="upload-report-cover-editor">
            <input
              class="mono"
              value={props.value}
              placeholder="https://"
              onInput={(e) => props.onChange(e.currentTarget.value)}
            />
            <Show when={editing()}>
              <Button variant="secondary" size="sm" onClick={() => setEditing(false)}>
                Done
              </Button>
            </Show>
          </div>
        }
      >
        <div class="upload-report-cover-preview">
          <button type="button" class="upload-report-cover-thumb-btn" onClick={openCover}>
            <img class="upload-report-cover-thumb" src={previewSrc()} alt="Cover" />
          </button>
          <div class="upload-report-cover-details">
            <div class="mono upload-report-cover-meta">{meta()}</div>
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              Edit cover URL
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

function submissionTone(status: UploadSubmission['status']): BadgeTone {
  switch (status) {
    case 'done':
      return 'success'
    case 'failed':
      return 'error'
    case 'running':
      return 'accent'
    default:
      return 'neutral'
  }
}

function SubmissionRow(props: { submission: UploadSubmission }) {
  const sub = () => props.submission
  return (
    <div class="upload-submission">
      <div class="upload-submission-top">
        <div class="upload-submission-label">
          <Show when={sub().status === 'running'}>
            <Spinner size="sm" />
          </Show>
          <span>{sub().label}</span>
        </div>
        <Badge tone={submissionTone(sub().status)}>{sub().status}</Badge>
      </div>

      <Show when={sub().url}>
        {(url) => (
          <button
            type="button"
            class="upload-submission-link"
            onClick={() => void window.gravlax.shell.openExternal(url())}
          >
            Open on tracker
          </button>
        )}
      </Show>

      <Show when={sub().lossyReport === 'failed'}>
        <div class="upload-submission-note">
          Torrent uploaded, but the lossy master report failed — file it by hand.
        </div>
      </Show>

      <Show when={sub().error}>
        {(error) => <div class="upload-submission-error">{error()}</div>}
      </Show>
    </div>
  )
}

export function UploadStep(props: {
  state: UploadFlowStateJSON
  config: Config
  health: HealthResult | null
  healthLoading: boolean
}) {
  const upload = () => props.state.upload
  const enabledTrackers = createMemo(() => enabledTrackerOptions(props.config))
  const derivedFromTags = createMemo(() =>
    derivedUploadFieldsFromTags(props.state.tags.proposed, {
      useUpcAsCatNo: props.config.workflow.useUpcAsCatNo
    })
  )
  const mismatch = (key: DerivedUploadFieldKey): string | null =>
    derivedFieldMismatchMessage(key, upload(), derivedFromTags())
  const artistsForEditor = createMemo(() => {
    const artists = editorArtistsFromUpload(upload().artists)
    return artists.length > 0 ? artists : [{ name: '', role: DEFAULT_ARTIST_ROLE }]
  })

  onMount(() => {
    void window.gravlax.upload.ensureUploadReport()
  })

  const patch = (next: Parameters<typeof window.gravlax.upload.updateUploadReport>[0]): void => {
    void window.gravlax.upload.updateUploadReport(next)
  }

  const toggleTracker = (id: UploadTrackerId): void => {
    const current = new Set(upload().selectedTrackerIds ?? [])
    if (current.has(id)) current.delete(id)
    else current.add(id)
    patch({ selectedTrackerIds: [...current] })
  }

  const updateFormat = (index: number, next: Partial<UploadFormatPayload>): void => {
    const formats = (upload().formats ?? []).map((f, i) => (i === index ? { ...f, ...next } : f))
    patch({ formats })
  }

  const blockedReason = createMemo(
    () => uploadBlockedReason(props.state, props.config, props.health, props.healthLoading)
  )
  const submissions = createMemo(() => upload().submissions ?? [])
  const showOrpheusSplit = createMemo(() => isOrpheusSplitEligible(upload()))
  const completed = createMemo(() => submissions().filter((s) => s.status === 'done'))
  const isRetry = createMemo(() => completed().length > 0 && upload().phase !== 'done')
  const detailsVisible = createMemo(() =>
    submissions().length > 0 || Boolean(upload().error)
  )

  return (
    <Section title="Upload" description="Review what will be uploaded and where.">
      {/* TODO(v1.0.0): Remove this beta notice and its styles. */}
      <Callout tone="info" class="upload-beta-notice">
        <span>
          During the Gravlax beta, it's recommended you check your files manually before uploading.
        </span>
        <Button
          variant="secondary"
          size="sm"
          disabled={!props.state.draft.workspacePath}
          onClick={() => void window.gravlax.shell.openPath(`${props.state.draft.workspacePath}/..`)}
        >
          <Icon name="folder" size={14} />
          Open Workspace
        </Button>
      </Callout>

      <Show when={props.state.transcode?.phase === 'running'}>
        <Callout tone="info">Transcoding is still running in the background.</Callout>
      </Show>

      <Show when={detailsVisible()}>
        <Card class="upload-report-card upload-progress-card">
          <div class="upload-progress-title">Upload details</div>
          <Show when={submissions().length > 0}>
            <div class="upload-submission-list">
              <For each={submissions()}>
                {(submission) => <SubmissionRow submission={submission} />}
              </For>
            </div>
          </Show>
          <Show when={upload().error}>
            {(error) => <Callout tone="error">{error()}</Callout>}
          </Show>
          <Show when={isRetry()}>
            <div class="upload-submission-note">
              Retrying sends only the uploads that have not succeeded.
            </div>
          </Show>
        </Card>
      </Show>

      <Card class="upload-report-card">
        <div class="upload-report-heading">Destinations</div>
        <Show
          when={enabledTrackers().length > 0}
          fallback={
            <Callout tone="warning">
              No trackers enabled. Enable Redacted and/or Orpheus in Settings → Trackers.
            </Callout>
          }
        >
          <div class="upload-report-trackers">
            <For each={enabledTrackers()}>
              {(id) => {
                const selected = () => (upload().selectedTrackerIds ?? []).includes(id)
                return (
                  <Card
                    interactive
                    selected={selected()}
                    class="upload-report-tracker"
                    onClick={() => toggleTracker(id)}
                  >
                    <TrackerIcon trackerId={id} size={20} />
                    <div class="upload-report-tracker-name">{trackerLabel(id)}</div>
                    <Show when={selected()}>
                      <Icon name="check" size={16} class="upload-report-tracker-check" />
                    </Show>
                  </Card>
                )
              }}
            </For>
          </div>
        </Show>
      </Card>

      <GroupSuggestions state={props.state} config={props.config} />

      <Card class="upload-report-card">
        <div class="upload-report-heading">Shared release fields</div>
        <div class="upload-report-grid">
          <div class="upload-report-field upload-report-field-full">
            <span>Artists</span>
            <ArtistsEditor
              artists={artistsForEditor()}
              autoFocus={false}
              onEdit={(action) =>
                patch({ artists: uploadArtistsFromEditor(applyArtistEdit(artistsForEditor(), action)) })
              }
            />
            <TagMismatchNote message={mismatch('artists')} />
          </div>

          <div class="upload-report-field">
            <span>Title</span>
            <input
              class="mono"
              value={upload().title ?? ''}
              onInput={(e) => patch({ title: e.currentTarget.value })}
            />
            <TagMismatchNote message={mismatch('title')} />
          </div>

          <div class="upload-report-field">
            <span>Year</span>
            <input
              class="mono"
              inputMode="numeric"
              value={upload().year ?? ''}
              onInput={(e) => patch({ year: parseYear(e.currentTarget.value) })}
            />
            <TagMismatchNote message={mismatch('year')} />
          </div>

          <div class="upload-report-field">
            <span>Release type</span>
            <Select
              value={upload().releaseType ?? ''}
              options={[...STANDARD_RELEASE_TYPES]}
              class="upload-report-release-type-select"
              onChange={(releaseType) => patch({ releaseType })}
            />
            <TagMismatchNote message={mismatch('releaseType')} />
          </div>

          <Show when={showOrpheusSplit()}>
            <div class="upload-report-field upload-report-field-full upload-report-orpheus-type">
              <span>Orpheus release type</span>
              <Select
                value={upload().orpheusSplit ? 'split' : 'shared'}
                options={['shared', 'split']}
                labelFor={(value) =>
                  value === 'split'
                    ? 'Split'
                    : `Same as shared (${displayOrEmpty(upload().releaseType)})`
                }
                class="upload-report-release-type-select"
                onChange={(value) => patch({ orpheusSplit: value === 'split' })}
              />
              <div class="upload-report-field-note">
                Choose Split when each main artist contributes several tracks of new material or
                new performances.
              </div>
            </div>
          </Show>

          <div class="upload-report-field">
            <span>Media</span>
            <div class="mono upload-report-readonly">{displayOrEmpty(upload().media)}</div>
          </div>

          <div class="upload-report-field">
            <span>
              Tags
              <Show when={anySelectedTrackerHasGroupId(upload())}>
                <Badge tone="warning">Ignored for destinations with a group ID</Badge>
              </Show>
            </span>
            <input
              class="mono"
              value={upload().tags ?? ''}
              placeholder="electronic, ambient"
              onInput={(e) => patch({ tags: e.currentTarget.value })}
            />
          </div>

          <CoverImageField
            value={upload().image ?? ''}
            coverPath={upload().coverPath}
            onChange={(image) => patch({ image })}
          />

          <div class="upload-report-field">
            <span>Edition year</span>
            <input
              class="mono"
              inputMode="numeric"
              value={upload().remasterYear ?? ''}
              onInput={(e) => patch({ remasterYear: parseYear(e.currentTarget.value) })}
            />
            <TagMismatchNote message={mismatch('remasterYear')} />
          </div>

          <div class="upload-report-field">
            <span>Edition title</span>
            <input
              class="mono"
              value={upload().remasterTitle ?? ''}
              onInput={(e) => patch({ remasterTitle: e.currentTarget.value })}
            />
            <TagMismatchNote message={mismatch('remasterTitle')} />
          </div>

          <div class="upload-report-field">
            <span>Record label</span>
            <input
              class="mono"
              value={upload().remasterRecordLabel ?? ''}
              onInput={(e) => patch({ remasterRecordLabel: e.currentTarget.value })}
            />
            <TagMismatchNote message={mismatch('remasterRecordLabel')} />
          </div>

          <div class="upload-report-field">
            <span>Catalogue number</span>
            <input
              class="mono"
              value={upload().remasterCatalogueNumber ?? ''}
              onInput={(e) => patch({ remasterCatalogueNumber: e.currentTarget.value })}
            />
            <TagMismatchNote message={mismatch('remasterCatalogueNumber')} />
          </div>

          <div class="upload-report-toggles">
            <label class="upload-report-toggle">
              <span>Scene</span>
              <Toggle on={Boolean(upload().scene)} onChange={(scene) => patch({ scene })} />
            </label>
            <label class="upload-report-toggle">
              <span>Unknown release</span>
              <Toggle on={Boolean(upload().unknown)} onChange={(unknown) => patch({ unknown })} />
            </label>
          </div>

          <BbcodeDescriptionField
            label="Album description"
            value={upload().albumDesc ?? ''}
            rows={10}
            badge={anySelectedTrackerHasGroupId(upload()) ? 'groupId' : undefined}
            onChange={(albumDesc) => patch({ albumDesc })}
          />
        </div>
      </Card>

      <div class="upload-report-formats-header">
        <div class="upload-report-heading">Uploads</div>
        <Badge tone="info">
          {(upload().formats ?? []).length} format
          {(upload().formats ?? []).length === 1 ? '' : 's'}
        </Badge>
      </div>

      <Show
        when={(upload().formats ?? []).length > 0}
        fallback={<Callout tone="warning">No format payloads prepared yet.</Callout>}
      >
        <Index each={upload().formats ?? []}>
          {(format, index) => (
            <Card class="upload-report-format-card">
              <div class="upload-report-format-title">
                <strong>{format().label}</strong>
                <span class="mono upload-report-path">{format().folderPath}</span>
              </div>
              <Show when={props.state.draft.lossyMaster}>
                <Callout tone="warning">
                  <Icon name="alert-triangle" size={16} />
                  <span>This upload will be reported as a lossy master.</span>
                </Callout>
              </Show>
              <div class="upload-report-grid upload-report-format-grid">
                <div class="upload-report-field">
                  <span>Format</span>
                  <div class="mono upload-report-readonly">{displayOrEmpty(format().format)}</div>
                </div>
                <div class="upload-report-field">
                  <span>Bitrate</span>
                  <div class="mono upload-report-readonly">{displayOrEmpty(format().bitrate)}</div>
                </div>
                <div class="upload-report-field">
                  <span>Torrent size</span>
                  <div class="mono upload-report-readonly">
                    {displayByteSize(format().sizeBytes)}
                  </div>
                </div>
                <Show when={format().logfileNames.length > 0}>
                  <div class="upload-report-field upload-report-field-full">
                    <span>Log files</span>
                    <div class="mono upload-report-logs">
                      {format().logfileNames.join(', ')}
                    </div>
                  </div>
                </Show>
                <BbcodeDescriptionField
                  label="Release description"
                  value={format().releaseDesc}
                  previewValue={spectralDescriptionPreview(
                    format().releaseDesc,
                    props.state.draft.spectralIds
                  )}
                  rows={8}
                  onChange={(releaseDesc) => updateFormat(index, { releaseDesc })}
                />
              </div>
            </Card>
          )}
        </Index>
      </Show>

      <Show when={!upload().error && upload().phase !== 'done' && blockedReason()}>
        {(reason) => <Callout tone="warning">{reason()}</Callout>}
      </Show>
    </Section>
  )
}

export function UploadSubmitAction(props: {
  state: UploadFlowStateJSON
  config: Config
  health: HealthResult | null
  healthLoading: boolean
  submitRequestActive: boolean
  onSubmit: () => void
}) {
  const [confirming, setConfirming] = createSignal(false)
  const upload = () => props.state.upload
  const completed = createMemo(() =>
    (upload().submissions ?? []).filter((submission) => submission.status === 'done')
  )
  const isRetry = createMemo(() => completed().length > 0 && upload().phase !== 'done')
  const submitting = createMemo(() => upload().phase === 'submitting')
  const busy = createMemo(() => props.submitRequestActive || submitting())
  const blockedReason = createMemo(
    () => uploadBlockedReason(props.state, props.config, props.health, props.healthLoading)
  )
  const canSubmit = createMemo(
    () => upload().phase !== 'done' && !busy() && blockedReason() === null
  )

  const plannedUploads = createMemo(() =>
    (upload().selectedTrackerIds ?? []).flatMap((trackerId) =>
      (upload().formats ?? [])
        .filter(
          (format) =>
            !completed().some(
              (submission) =>
                submission.trackerId === trackerId && submission.formatId === format.id
            )
        )
        .map((format) => {
          const groupId = upload().groupIds?.[trackerId]
          const target =
            typeof groupId === 'number'
              ? `group ${groupId}`
              : `a new ${effectiveReleaseType(upload(), trackerId)} group`
          return `${trackerLabel(trackerId)} · ${format.label} → ${target}`
        })
    )
  )

  const startSubmit = (): void => {
    setConfirming(true)
  }

  return (
    <>
      <Button
        variant="primary"
        loading={busy() && upload().phase !== 'done'}
        disabled={!canSubmit()}
        onClick={startSubmit}
      >
        {submitButtonLabel(
          upload().phase,
          props.submitRequestActive,
          submitting(),
          isRetry()
        )}
      </Button>

      <Show when={confirming()}>
        <Modal
          title={isRetry() ? 'Retry failed uploads?' : 'Upload to the tracker?'}
          description={`This posts ${plannedUploads().length} torrent${
            plannedUploads().length === 1 ? '' : 's'
          } and cannot be undone from here:\n${plannedUploads().join('\n')}`}
          options={[isRetry() ? 'Retry failed' : 'Upload', 'Cancel']}
          defaultIndex={1}
          onChoose={(index) => {
            setConfirming(false)
            if (index === 0) props.onSubmit()
          }}
        />
      </Show>
    </>
  )
}

function submitButtonLabel(
  phase: string | undefined,
  requestActive: boolean,
  submitting: boolean,
  isRetry: boolean
): string {
  if (phase === 'done') return 'Uploaded'
  if (submitting) return 'Uploading…'
  if (requestActive) return 'Preparing…'
  return isRetry ? 'Retry failed' : 'Submit'
}
