import { Show, createSignal } from 'solid-js'
import type { SourceMedia, UploadFlowStateJSON } from '@shared/types'
import { SOURCE_MEDIA_OPTIONS } from '@shared/upload/sourceMedia'
import { Card, Icon, ProgressBar, Section, SegmentedControl } from '../../../ui'
import {
  FileChecksResult,
  IntegrityResult,
  LogcheckerResult,
  MqaResult,
  StructureResult,
  UpconvertResult
} from '../fileChecks'

export function FileChecksStep(props: { state: UploadFlowStateJSON }) {
  const [expanded, setExpanded] = createSignal(false)

  const task = () => props.state.background.tasks.find((t) => t.id === 'file-checks')
  const detail = () => task()?.detail ?? ''
  const status = () => task()?.status
  const fileChecks = () => props.state.fileChecks
  const media = () => props.state.draft.sourceMedia
  const logCount = () => props.state.fileChecks.logs.logFiles.length
  return (
    <Section>
      <Show when={media()}>
        <Card class="file-checks-media">
          <div class="file-checks-media-text">
            <div class="file-checks-media-label">Source media</div>
            <div class="file-checks-sub">
              {media() === 'CD'
                ? logCount() > 0
                  ? `Read as a CD rip from ${logCount()} log file${logCount() === 1 ? '' : 's'}. Rip logs go to the tracker's logchecker.`
                  : "Read as a CD rip. Rip logs go to the tracker's logchecker."
                : 'No rip logs found, so this is read as WEB. Switch to CD to run the logchecker.'}
            </div>
          </div>
          <SegmentedControl
            value={media() || 'WEB'}
            options={SOURCE_MEDIA_OPTIONS.map((option: SourceMedia) => ({ value: option, label: option }))}
            onChange={(next) => void window.gravlax.upload.selectSourceMedia(next)}
          />
        </Card>
      </Show>

      <Show when={!task()}>
        <FileChecksResult tone="info" icon={props.state.draft.sourcePath ? 'activity' : 'info'}>
          <Show
            when={props.state.draft.sourcePath}
            fallback={
              <>
                <div class="file-checks-headline">Waiting for a source folder</div>
                <div class="file-checks-sub">Choose a release from the start menu to begin file checks.</div>
              </>
            }
          >
            <div class="file-checks-headline">Preparing the working copy…</div>
            <div class="file-checks-sub">
              Copying the release, then reading it to work out WEB or CD.
            </div>
          </Show>
        </FileChecksResult>
      </Show>

      <Show when={task() && (status() === 'running' || status() === 'queued')}>
        <FileChecksResult tone="info" icon="activity">
          <div class="file-checks-headline">Checking files…</div>
          <div class="file-checks-sub">
            {task()?.progressTotal && task()!.progressTotal > 0
              ? `${task()!.progressCurrent}/${task()!.progressTotal}${task()!.progressLabel ? ` — ${task()!.progressLabel}` : ''}`
              : 'Scanning release files for issues…'}
          </div>
          <Show when={(task()?.progressTotal ?? 0) > 0}>
            <ProgressBar
              value={task()!.progressCurrent ?? 0}
              max={task()!.progressTotal ?? 0}
              label="File checks progress"
            />
          </Show>
        </FileChecksResult>
      </Show>

      <Show when={status() === 'failed'}>
        <FileChecksResult tone="error" icon="alert-triangle">
          <div class="file-checks-headline">File checks failed</div>
          <Show when={fileChecks().error}>
            {(message) => <div class="file-checks-sub">{message()}</div>}
          </Show>
        </FileChecksResult>
      </Show>

      <Show when={status() === 'succeeded'}>
        <StructureResult state={props.state} />
        <IntegrityResult state={props.state} />
        <MqaResult fileChecks={fileChecks()} />
        <UpconvertResult fileChecks={fileChecks()} />
        <LogcheckerResult fileChecks={fileChecks()} />
      </Show>

      <Show when={detail()}>
        <Card class="file-checks-log-card">
          <button
            type="button"
            class={`file-checks-log-toggle ${expanded() ? 'is-open' : ''}`}
            aria-expanded={expanded()}
            onClick={() => setExpanded((v) => !v)}
          >
            <Icon name="chevron-down" size={14} />
            {expanded() ? 'Hide log' : 'Show log'}
          </button>
          <Show when={expanded()}>
            <pre class="file-checks-log mono">{detail()}</pre>
          </Show>
        </Card>
      </Show>
    </Section>
  )
}
