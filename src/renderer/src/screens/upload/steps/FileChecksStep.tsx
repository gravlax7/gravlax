import { For, Show, createSignal } from 'solid-js'
import type {
  RepairFlowProgress,
  RepairFlowStage,
  SourceMedia,
  UploadFlowStateJSON
} from '@shared/types'
import { SOURCE_MEDIA_OPTIONS } from '@shared/upload/sourceMedia'
import { Card, Icon, ProgressBar, Section, SegmentedControl, Spinner } from '../../../ui'
import {
  AudioSettingsResult,
  FileChecksResult,
  IntegrityResult,
  LogcheckerResult,
  MqaResult,
  StructureResult,
  UpconvertResult
} from '../fileChecks'

const REPAIR_STAGES: Array<{ id: RepairFlowStage; label: string }> = [
  { id: 'scan', label: 'Confirm failures' },
  { id: 'repair', label: 'Repair FLACs' },
  { id: 'verify', label: 'Verify integrity' },
  { id: 'mqa', label: 'Check MQA' },
  { id: 'upconvert', label: 'Check upconverts' }
]

function repairStageIndex(stage: RepairFlowStage): number {
  return REPAIR_STAGES.findIndex((item) => item.id === stage)
}

function repairProgressLabel(label: string): string {
  const separator = label.indexOf(' — ')
  return separator < 0 ? label : label.slice(separator + 3)
}

function RepairProgress(props: { progress: RepairFlowProgress; sourceMedia: SourceMedia }) {
  const currentStage = () => repairStageIndex(props.progress.stage)
  return (
    <FileChecksResult tone="info" icon="activity">
      <div class="file-checks-headline">Checking FLACs and repairing issues…</div>
      <div class="file-checks-repair-stages" aria-label="Repair stages">
        <For each={REPAIR_STAGES}>
          {(stage, index) => {
            const status = () =>
              index() < currentStage()
                ? 'done'
                : index() === currentStage()
                  ? 'current'
                  : 'upcoming'
            return (
              <div class={`file-checks-repair-stage is-${status()}`}>
                <span class="file-checks-repair-marker">
                  <Show
                    when={status() === 'done'}
                    fallback={
                      <Show when={status() === 'current'} fallback={index() + 1}>
                        <Spinner size="sm" />
                      </Show>
                    }
                  >
                    <Icon name="check" size={14} />
                  </Show>
                </span>
                <span>{stage.label}</span>
              </div>
            )
          }}
        </For>
      </div>
      <div class="file-checks-sub">
        Stage {currentStage() + 1} of {REPAIR_STAGES.length}
        {props.progress.label ? ` — ${repairProgressLabel(props.progress.label)}` : ''}
      </div>
      <Show when={props.sourceMedia === 'CD'}>
        <div class="file-checks-sub">Rip logs are checked at the same time.</div>
      </Show>
      <Show when={props.progress.total > 0}>
        <ProgressBar
          value={props.progress.current}
          max={props.progress.total}
          label={`${REPAIR_STAGES[currentStage()]?.label ?? 'Repair'} progress`}
        />
      </Show>
    </FileChecksResult>
  )
}

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

      <Show when={
        task() &&
        (status() === 'running' || status() === 'queued') &&
        fileChecks().repair
      }>
        <RepairProgress progress={fileChecks().repair!} sourceMedia={media() || 'WEB'} />
      </Show>

      <Show when={
        task() &&
        (status() === 'running' || status() === 'queued') &&
        !fileChecks().repair
      }>
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
        <AudioSettingsResult audio={fileChecks().audio} />
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
