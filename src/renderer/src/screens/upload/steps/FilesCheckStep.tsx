import { For, Show, createSignal } from 'solid-js'
import type { SourceMedia, UploadFlowStateJSON } from '@shared/types'
import {
  hasLogResults,
  hasUpconvertResults,
  logHeadline,
  logScores,
  logTone,
  mqaHeadline,
  mqaTone,
  upconvertFindings,
  upconvertHeadline,
  upconvertTone
} from '@shared/upload/filesCheck'
import { Card, Icon, ProgressBar, SegmentedControl } from '../../../ui'

const SOURCE_MEDIA: SourceMedia[] = ['WEB', 'CD']

export function FilesCheckStep(props: { state: UploadFlowStateJSON }) {
  const [expanded, setExpanded] = createSignal(false)

  const task = () => props.state.background.tasks.find((t) => t.id === 'files-check')
  const detail = () => task()?.detail ?? ''
  const status = () => task()?.status
  const filesCheck = () => props.state.filesCheck
  const scores = () => logScores(filesCheck())
  const upconverts = () => upconvertFindings(filesCheck())
  const mqa = () => mqaTone(filesCheck())
  const upconvert = () => upconvertTone(filesCheck())
  const logs = () => logTone(filesCheck())
  const cardTone = () => {
    if (!task()) return 'info' as const
    if (status() === 'failed') return 'error' as const
    if (status() === 'running' || status() === 'queued') return 'info' as const
    if (mqa() === 'warning' || upconvert() === 'warning' || logs() === 'warning') {
      return 'warning' as const
    }
    if (mqa() === 'success' || upconvert() === 'success' || logs() === 'success') {
      return 'success' as const
    }
    return 'info' as const
  }

  const media = () => props.state.draft.sourceMedia
  const logCount = () => props.state.filesCheck.logs.logFiles.length

  return (
    <>
      <Show when={media()}>
        <Card class="files-check-media">
          <div class="files-check-media-text">
            <div class="files-check-media-label">Source media</div>
            <div class="files-check-sub">
              {media() === 'CD'
                ? logCount() > 0
                  ? `Read as a CD rip from ${logCount()} log file${logCount() === 1 ? '' : 's'}. Rip logs go to the tracker's logchecker.`
                  : "Read as a CD rip. Rip logs go to the tracker's logchecker."
                : 'No rip logs found, so this is read as WEB. Switch to CD to run the logchecker.'}
            </div>
          </div>
          <SegmentedControl
            value={media() || 'WEB'}
            options={SOURCE_MEDIA.map((option: SourceMedia) => ({ value: option, label: option }))}
            onChange={(next) => void window.gravlax.upload.selectSourceMedia(next)}
          />
        </Card>
      </Show>

      <Card class={`files-check-card files-check-${cardTone()}`}>
        <Show when={!task()}>
          <div class="files-check-result">
            <Icon name={props.state.draft.sourcePath ? 'activity' : 'info'} size={20} />
            <div class="files-check-result-body">
              <Show
                when={props.state.draft.sourcePath}
                fallback={
                  <>
                    <div class="files-check-headline">Waiting for a source folder</div>
                    <div class="files-check-sub">Choose a release from the start menu to begin files check.</div>
                  </>
                }
              >
                <div class="files-check-headline">Preparing the working copy…</div>
                <div class="files-check-sub">
                  Copying the release, then reading it to work out WEB or CD.
                </div>
              </Show>
            </div>
          </div>
        </Show>

        <Show when={task() && (status() === 'running' || status() === 'queued')}>
          <div class="files-check-result">
            <Icon name="activity" size={20} />
            <div class="files-check-result-body">
              <div class="files-check-headline">Checking files…</div>
              <div class="files-check-sub">
                {task()?.progressTotal && task()!.progressTotal > 0
                  ? `${task()!.progressCurrent}/${task()!.progressTotal}${task()!.progressLabel ? ` — ${task()!.progressLabel}` : ''}`
                  : 'Scanning release files for issues…'}
              </div>
            </div>
          </div>
        </Show>

        <Show when={status() === 'failed'}>
          <div class="files-check-result">
            <Icon name="alert-triangle" size={20} />
            <div class="files-check-result-body">
              <div class="files-check-headline">Files check failed</div>
              <Show when={filesCheck().error}>
                {(message) => <div class="files-check-sub">{message()}</div>}
              </Show>
            </div>
          </div>
        </Show>

        <Show when={status() === 'succeeded'}>
          <div class="files-check-results">
            <Show when={mqaHeadline(filesCheck())}>
              {(title) => (
                <div class={`files-check-result files-check-result-${mqa()}`}>
                  <Icon name={mqa() === 'success' ? 'check' : 'alert-triangle'} size={20} />
                  <div class="files-check-result-body">
                    <div class="files-check-headline">{title()}</div>
                  </div>
                </div>
              )}
            </Show>

            <Show when={hasUpconvertResults(filesCheck())}>
              <div class={`files-check-result files-check-result-${upconvert()}`}>
                <Icon
                  name={
                    upconvert() === 'success'
                      ? 'check'
                      : upconvert() === 'warning'
                        ? 'alert-triangle'
                        : 'info'
                  }
                  size={20}
                />
                <div class="files-check-result-body">
                  <div class="files-check-headline">{upconvertHeadline(filesCheck())}</div>
                  <Show when={upconverts().length > 0}>
                    <div class="files-check-scores">
                      <For each={upconverts()}>
                        {(entry) => (
                          <div class="files-check-score-row">
                            <span class="files-check-score-value is-imperfect">
                              {entry.wastedBits}/{entry.bitDepth}
                            </span>
                            <div class="files-check-score-meta">
                              <span class="files-check-score-tracker">Wasted bits</span>
                              <span class="files-check-score-file">{entry.fileName}</span>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>

            <Show when={hasLogResults(filesCheck())}>
              <div class={`files-check-result files-check-result-${logs()}`}>
                <Icon name={logs() === 'success' ? 'check' : 'alert-triangle'} size={20} />
                <div class="files-check-result-body">
                  <div class="files-check-headline">{logHeadline(filesCheck())}</div>
                  <Show when={scores().length > 0}>
                    <div class="files-check-scores">
                      <For each={scores()}>
                        {(entry) => (
                          <div class="files-check-score-row">
                            <span
                              class={`files-check-score-value ${entry.score === 100 ? 'is-perfect' : 'is-imperfect'}`}
                            >
                              {entry.score}
                            </span>
                            <div class="files-check-score-meta">
                              <span class="files-check-score-tracker">{entry.tracker}</span>
                              <span class="files-check-score-file">{entry.fileName}</span>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </Show>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={(status() === 'running' || status() === 'queued') && (task()?.progressTotal ?? 0) > 0}>
          <ProgressBar
            value={task()!.progressCurrent ?? 0}
            max={task()!.progressTotal ?? 0}
            label="Files check progress"
          />
        </Show>

        <Show when={detail()}>
          <button
            type="button"
            class="files-check-log-toggle"
            onClick={() => setExpanded((v) => !v)}
          >
            <Icon name="chevron-down" size={14} />
            {expanded() ? 'Hide log' : 'Show log'}
          </button>
          <Show when={expanded()}>
            <pre class="files-check-log mono">{detail()}</pre>
          </Show>
        </Show>
      </Card>
    </>
  )
}
