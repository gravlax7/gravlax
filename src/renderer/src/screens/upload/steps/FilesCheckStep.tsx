import { Show, createSignal } from 'solid-js'
import type { SourceMedia, UploadFlowStateJSON } from '@shared/types'
import {
  integrityTone,
  logTone,
  mqaTone,
  upconvertTone
} from '@shared/upload/filesCheck'
import { Card, Icon, ProgressBar, SegmentedControl } from '../../../ui'
import {
  IntegrityResult,
  LogcheckerResult,
  MqaResult,
  UpconvertResult
} from '../filesCheck'

const SOURCE_MEDIA: SourceMedia[] = ['WEB', 'CD']

export function FilesCheckStep(props: { state: UploadFlowStateJSON }) {
  const [expanded, setExpanded] = createSignal(false)

  const task = () => props.state.background.tasks.find((t) => t.id === 'files-check')
  const detail = () => task()?.detail ?? ''
  const status = () => task()?.status
  const filesCheck = () => props.state.filesCheck
  const integrity = () => integrityTone(filesCheck())
  const mqa = () => mqaTone(filesCheck())
  const upconvert = () => upconvertTone(filesCheck())
  const logs = () => logTone(filesCheck())
  const cardTone = () => {
    if (!task()) return 'info' as const
    if (status() === 'failed') return 'error' as const
    if (status() === 'running' || status() === 'queued') return 'info' as const
    if (integrity() === 'warning' || mqa() === 'warning' || upconvert() === 'warning' || logs() === 'warning') {
      return 'warning' as const
    }
    if (integrity() === 'success' || mqa() === 'success' || upconvert() === 'success' || logs() === 'success') {
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
            <IntegrityResult state={props.state} />
            <MqaResult filesCheck={filesCheck()} />
            <UpconvertResult filesCheck={filesCheck()} />
            <LogcheckerResult filesCheck={filesCheck()} />
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
