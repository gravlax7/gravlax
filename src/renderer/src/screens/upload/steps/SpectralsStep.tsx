import { For, Show } from 'solid-js'
import type { FlaccheckFileResult, FlaccheckHiresVerdict, UploadFlowStateJSON } from '@shared/types'
import {
  flaccheckHiresSuspectCount,
  flaccheckSuspectCount,
  isFakeHires,
  isLikelyLossy
} from '@shared/upload/flaccheck'
import { toggleSpectralId } from '@shared/upload/spectralIds'
import {
  Badge,
  Button,
  Card,
  Callout,
  Icon,
  ProgressBar,
  Section,
  SegmentedControl,
  Skeleton
} from '../../../ui'
import { spectralUrl } from '../pathUtil'

function hiresBadgeLabel(verdict: FlaccheckHiresVerdict): string {
  if (verdict === 'PADDED_DEPTH') return 'Likely padded 16→24'
  if (verdict === 'UPSAMPLED') return 'Likely upsampled'
  return 'Fake hi-res'
}

export function SpectralsStep(props: {
  state: UploadFlowStateJSON
  spectrals: Array<{ full: string; zoom: string; index: number; filename: string }>
  onOpenLightbox: (index: number) => void
}) {
  const task = () => props.state.background.tasks.find((t) => t.id === 'spectrals')
  const selectedIds = () => props.state.draft.spectralIds
  const isSelected = (index: number) => selectedIds().includes(index)
  const toggle = (index: number) =>
    void window.gravlax.upload.setSpectralIds(toggleSpectralId(selectedIds(), index))
  const generating = () =>
    (task()?.status === 'running' || task()?.status === 'queued') && props.spectrals.length === 0

  const flaccheckFile = (filename: string): FlaccheckFileResult | undefined =>
    props.state.flaccheck?.files?.find((f) => f.path === filename)

  const suspectCount = () => flaccheckSuspectCount(props.state.flaccheck)
  const hiresSuspectCount = () => flaccheckHiresSuspectCount(props.state.flaccheck)

  const detailColor = (): string => {
    if (task()?.status === 'failed') return 'var(--error)'
    if (suspectCount() > 0 || hiresSuspectCount() > 0) return 'var(--warning)'
    return 'var(--fg-primary)'
  }

  const lightboxIndexFor = (pair: { full: string; zoom: string }, useZoom: boolean): number => {
    const images = props.spectrals.flatMap((s) => [
      { src: s.full, label: s.filename },
      { src: s.zoom, label: `${s.filename} (zoom)` }
    ])
    const src = useZoom ? pair.zoom : pair.full
    return images.findIndex((img) => img.src === src)
  }

  return (
    <Section title="Spectrals" description="Review spectrals before continuing.">
      <Show when={task()}>
        {(t) => (
          <div class="spectrals-status">
            <div style={{ color: detailColor(), 'white-space': 'pre-wrap' }}>
              {t().detail || t().status}
            </div>
            <Show when={t().progressTotal > 0 && (t().status === 'running' || t().status === 'queued')}>
              <ProgressBar value={t().progressCurrent} max={t().progressTotal} />
            </Show>
          </div>
        )}
      </Show>

      <div class="spectrals-lossy">
        <span class="spectrals-lossy-label">Lossy report</span>
        <SegmentedControl
          value={props.state.draft.lossyMaster ? 'lossy' : 'not-lossy'}
          options={[
            { value: 'not-lossy', label: 'Not lossy' },
            { value: 'lossy', label: 'Lossy master' }
          ]}
          onChange={(value: string) => void window.gravlax.upload.setLossyMaster(value === 'lossy')}
        />
      </div>

      <Show when={props.state.draft.lossyMaster}>
        <div class="spectrals-lossy-comment">
          <label class="spectrals-lossy-label" for="lossy-comment">
            Lossy comment
          </label>
          <div class="spectrals-lossy-comment-hint">
            Optional note for the lossy approval report. Spectrals are included automatically at
            report time.
          </div>
          <textarea
            id="lossy-comment"
            rows={3}
            value={props.state.draft.lossyComment}
            placeholder="e.g. Sourced from Bandcamp"
            onInput={(e) => void window.gravlax.upload.setLossyComment(e.currentTarget.value)}
          />
        </div>
      </Show>

      <Show when={suspectCount() > 0}>
        <Callout tone="warning">
          flaccheck flagged {suspectCount()} track{suspectCount() === 1 ? '' : 's'} as likely lossy —
          review spectrals before choosing.
        </Callout>
      </Show>

      <Show when={hiresSuspectCount() > 0}>
        <Callout tone="warning">
          flaccheck flagged {hiresSuspectCount()} track{hiresSuspectCount() === 1 ? '' : 's'} as fake
          hi-res (padded bit depth or upsampled) — review before uploading as 24-bit.
        </Callout>
      </Show>

      <Show when={props.spectrals[0]}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void window.gravlax.shell.revealPath(props.spectrals[0]!.full)}
        >
          <Icon name="external-link" size={14} />
          Reveal in Finder/Explorer
        </Button>
      </Show>

      <Show when={props.spectrals.length > 0}>
        <div class="spectrals-select-header">
          <div class="spectrals-select-title">
            Hosted for the description: {selectedIds().length} of {props.spectrals.length}
          </div>
          <div class="spectrals-select-actions">
            <button
              type="button"
              onClick={() =>
                void window.gravlax.upload.setSpectralIds(props.spectrals.map((s) => s.index))
              }
            >
              Select all
            </button>
            <button type="button" onClick={() => void window.gravlax.upload.setSpectralIds([])}>
              Select none
            </button>
          </div>
        </div>
        <Show when={selectedIds().length === 0}>
          <Callout tone="warning">
            No spectrals selected — the release description will not show any.
          </Callout>
        </Show>
      </Show>

      <div class="spectrals-gallery">
        <Show
          when={!generating()}
          fallback={
            <For each={[1, 2, 3]}>
              {() => (
                <Card class="spectral-card">
                  <Skeleton height="14px" width="40%" />
                  <Skeleton height="120px" />
                </Card>
              )}
            </For>
          }
        >
          <For each={props.spectrals}>
            {(pair) => {
              const file = () => flaccheckFile(pair.filename)
              const likelyLossy = () => {
                const f = file()
                return f ? isLikelyLossy(f) : false
              }
              const fakeHires = () => {
                const f = file()
                return f ? isFakeHires(f) : false
              }
              return (
                <Card class="spectral-card" selected={isSelected(pair.index)}>
                  <div class="spectral-card-header">
                    <label class="spectral-host-toggle">
                      <input
                        type="checkbox"
                        checked={isSelected(pair.index)}
                        onChange={() => toggle(pair.index)}
                      />
                      Host
                    </label>
                    <span class="mono spectral-filename">{pair.filename}</span>
                    <Show when={likelyLossy()}>
                      <Badge tone="warning">Likely lossy</Badge>
                    </Show>
                    <Show when={fakeHires()}>
                      <Badge tone="warning">{hiresBadgeLabel(file()!.hiresVerdict)}</Badge>
                    </Show>
                  </div>
                  <div class="spectral-thumbs">
                    <button
                      type="button"
                      class="spectral-thumb spectral-thumb-full"
                      onClick={() => props.onOpenLightbox(lightboxIndexFor(pair, false))}
                    >
                      <img src={spectralUrl(pair.full)} alt={`Full spectral for ${pair.filename}`} />
                    </button>
                    <button
                      type="button"
                      class="spectral-thumb spectral-thumb-zoom"
                      onClick={() => props.onOpenLightbox(lightboxIndexFor(pair, true))}
                    >
                      <img src={spectralUrl(pair.zoom)} alt={`Zoom spectral for ${pair.filename}`} />
                    </button>
                  </div>
                </Card>
              )
            }}
          </For>
        </Show>
      </div>
    </Section>
  )
}
