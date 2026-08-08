import { For, Show } from 'solid-js'
import type { UploadFlowStateJSON } from '@shared/types'
import { isTranscodeBusy } from '@shared/upload/stepGating'
import { Badge, Card, Callout, ProgressBar, Section } from '../../../ui'
import { Toggle } from '../../../components/Toggle'

export function TranscodeStep(props: { state: UploadFlowStateJSON }) {
  const task = () => props.state.background.tasks.find((t) => t.id === 'transcode')
  const busy = () => isTranscodeBusy(props.state.transcode)
  const hardBlocked = () =>
    (props.state.transcode?.inspection?.blockers ?? []).some(
      (b) => b.kind === 'lossy' || b.kind === 'empty'
    )

  const toggleOption = (optionId: string): void => {
    const current = new Set(props.state.transcode?.selectedOptionIds ?? [])
    if (current.has(optionId)) current.delete(optionId)
    else current.add(optionId)
    void window.gravlax.upload.setTranscodeSelection([...current])
  }

  const jobForOption = (optionId: string) =>
    (props.state.transcode?.jobs ?? []).find((j) => j.optionId === optionId)

  const jobStatusLabel = (status: string | undefined): string => {
    switch (status) {
      case 'queued':
        return 'Queued'
      case 'running':
        return 'Running'
      case 'succeeded':
        return 'Done'
      case 'failed':
        return 'Failed'
      default:
        return ''
    }
  }

  const jobTone = (status: string | undefined): 'neutral' | 'success' | 'error' | 'info' => {
    if (status === 'failed') return 'error'
    if (status === 'succeeded') return 'success'
    if (status === 'running' || status === 'queued') return 'info'
    return 'neutral'
  }

  return (
    <Section title="Transcode" description="Prepare alternate formats for upload.">
      <Show when={task()}>
        {(t) => (
          <div class="transcode-task-status">
            <div>{t().detail || t().status}</div>
            <Show when={t().progressTotal > 0 && props.state.transcode?.phase === 'running'}>
              <ProgressBar value={t().progressCurrent} max={t().progressTotal} />
              <div class="mono transcode-progress-label">{t().progressLabel}</div>
            </Show>
          </div>
        )}
      </Show>

      <Show when={props.state.transcode?.inspection}>
        {(inspection) => (
          <>
            <Card class="transcode-inspection">
              <div>
                <strong>Source:</strong> {inspection().encoding}
                <Show when={inspection().sampleRate > 0}>
                  {` (${(inspection().sampleRate / 1000).toFixed(1)} kHz)`}
                </Show>
              </div>
              <div>
                <strong>Tracks:</strong> {inspection().trackCount}
              </div>
              <Show when={inspection().hybrid}>
                <div class="transcode-hybrid-warning">
                  Mixed bit depths / sample rates — flagged as hybrid.
                </div>
              </Show>
            </Card>

            <Show when={inspection().blockers.length > 0}>
              <div class="transcode-blockers">
                <For each={inspection().blockers}>
                  {(blocker) => (
                    <Callout
                      tone={
                        blocker.kind === 'lossy' || blocker.kind === 'empty' ? 'error' : 'warning'
                      }
                    >
                      {blocker.message}
                    </Callout>
                  )}
                </For>
              </div>
            </Show>

            <Show when={!hardBlocked() && inspection().options.length > 0}>
              <div class="transcode-options-header">
                <div class="transcode-options-title">Formats to prepare</div>
                <div class="transcode-options-actions">
                  <button
                    type="button"
                    disabled={busy()}
                    onClick={() =>
                      void window.gravlax.upload.setTranscodeSelection(
                        inspection().options.map((o) => o.id)
                      )
                    }
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    disabled={busy()}
                    onClick={() => void window.gravlax.upload.setTranscodeSelection([])}
                  >
                    Select none
                  </button>
                </div>
              </div>

              <div class="transcode-options">
                <For each={inspection().options}>
                  {(option) => {
                    const selected = () =>
                      (props.state.transcode?.selectedOptionIds ?? []).includes(option.id)
                    const job = () => jobForOption(option.id)
                    return (
                      <Card
                        interactive={!busy()}
                        selected={selected()}
                        class="transcode-option-card"
                        onClick={() => {
                          if (busy()) return
                          toggleOption(option.id)
                        }}
                      >
                        <div class="transcode-option-row">
                          <input
                            type="checkbox"
                            checked={selected()}
                            disabled={busy()}
                            onChange={() => toggleOption(option.id)}
                            onClick={(event) => event.stopPropagation()}
                          />
                          <div class="transcode-option-body">
                            <div class="transcode-option-name">{option.name}</div>
                            <div class="mono transcode-option-folder">
                              → {option.outputFolderName}
                            </div>
                            <Show when={job()?.status}>
                              <Badge tone={jobTone(job()?.status)}>
                                {jobStatusLabel(job()?.status)}
                                <Show when={job()?.error}>: {job()?.error}</Show>
                              </Badge>
                            </Show>
                          </div>
                        </div>
                      </Card>
                    )
                  }}
                </For>
              </div>

              <div class="transcode-essential" classList={{ 'transcode-essential-busy': busy() }}>
                <Toggle
                  on={props.state.transcode?.essentialOnly ?? true}
                  onChange={(on) => {
                    if (busy()) return
                    void window.gravlax.upload.setTranscodeEssentialOnly(on)
                  }}
                  label="Copy essential only"
                />
                <span class="transcode-essential-help">
                  Essential only (images + audio)
                </span>
              </div>
            </Show>

            <Show when={!hardBlocked() && inspection().options.length === 0}>
              <div class="transcode-empty-options">No formats available for this release.</div>
            </Show>
          </>
        )}
      </Show>

      <Show when={!props.state.transcode?.inspection && !props.state.transcode?.error}>
        <div class="transcode-waiting">Waiting for transcode inspection…</div>
      </Show>
      <Show when={props.state.transcode?.error && !props.state.transcode?.inspection}>
        <Callout tone="error">{props.state.transcode?.error}</Callout>
      </Show>
    </Section>
  )
}
