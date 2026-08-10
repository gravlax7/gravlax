import { For, Show, createMemo } from 'solid-js'
import type { SeedTask, SeedTaskStatus, UploadFlowStateJSON } from '@shared/types'
import { etaSeconds, formatByteSize, formatEta, formatTransferRate } from '@shared/format'
import { Badge, Button, Callout, EmptyState, Icon, ProgressBar, type BadgeTone } from '../../../ui'

const TRACKER_LABELS: Record<string, string> = { redacted: 'RED', orpheus: 'OPS' }

/** Transfers and copies both move the release; injects hand it to the client. */
function isPlacement(task: SeedTask): boolean {
  return task.kind === 'transfer' || task.kind === 'copy'
}

function shownBytesTransferred(task: SeedTask): number {
  if (task.status === 'done' && task.bytesTotal !== undefined) return task.bytesTotal
  return task.bytesTransferred ?? 0
}

function shownFilesTransferred(task: SeedTask): number {
  if (task.status === 'done' && task.filesTotal !== undefined) return task.filesTotal
  return task.filesTransferred ?? 0
}

export function SeedStep(props: {
  state: UploadFlowStateJSON
  onRetry: () => void
}) {
  const seed = createMemo(() => props.state.seed ?? { phase: 'idle' as const, tasks: [] })
  const tasks = createMemo(() => seed().tasks ?? [])
  const phase = createMemo(() => seed().phase ?? 'idle')
  const uploadDone = createMemo(() => props.state.upload?.phase === 'done')
  const hasCompleted = createMemo(() => tasks().some((t) => t.status === 'done'))

  const totals = createMemo(() => {
    const placements = tasks().filter(isPlacement)
    return {
      count: tasks().length,
      finished: tasks().filter((t) => t.status === 'done' || t.status === 'skipped').length,
      bytesTransferred: placements.reduce((sum, t) => sum + shownBytesTransferred(t), 0),
      bytesTotal: placements.reduce((sum, t) => sum + (t.bytesTotal ?? 0), 0),
      // Only one placement runs at a time, so summing is the aggregate rate.
      bytesPerSecond: placements.reduce((sum, t) => sum + (t.bytesPerSecond ?? 0), 0)
    }
  })

  const summary = createMemo(() => {
    const t = totals()
    const parts = [`${t.finished} of ${t.count}`]
    if (t.bytesTotal > 0) {
      parts.push(`${formatByteSize(t.bytesTransferred)} / ${formatByteSize(t.bytesTotal)}`)
    }
    const rate = formatTransferRate(t.bytesPerSecond)
    if (rate) parts.push(rate)
    const eta = formatEta(etaSeconds(t.bytesTransferred, t.bytesTotal, t.bytesPerSecond))
    if (eta && phase() === 'running') parts.push(`~${eta} left`)
    return parts.join(' · ')
  })

  return (
    <div class="seed-step">
      <Show when={!uploadDone()}>
        <EmptyState
          icon="activity"
          title="Seed"
          description="Submit the upload first. Seeding runs after the tracker upload succeeds."
        />
      </Show>

      <Show when={uploadDone()}>
        <div class="seed-header">
          <div class="seed-header-text">
            <div class="seed-title">Seed</div>
            <div class="seed-subtitle">
              {phaseLabel(phase())}
              <Show when={seed().error}> — {seed().error}</Show>
            </div>
            <Show when={tasks().length > 0}>
              <div class="mono seed-summary">{summary()}</div>
            </Show>
          </div>
          <Show when={phase() === 'failed' || phase() === 'done'}>
            <Button variant="secondary" onClick={() => props.onRetry()}>
              <Icon name="refresh-cw" size={14} />
              {hasCompleted() ? 'Retry failed' : 'Retry'}
            </Button>
          </Show>
        </div>

        <Show when={phase() === 'running' && totals().bytesTotal > 0}>
          <ProgressBar
            value={totals().bytesTransferred}
            max={totals().bytesTotal}
            tone="accent"
            label="Overall seeding progress"
          />
        </Show>

        <Show when={tasks().length === 0 && phase() !== 'running'}>
          <Callout tone="info">
            Seedbox, seeding folder and torrent client are all off, or no torrents were created.
          </Callout>
        </Show>

        <Show when={tasks().length > 0}>
          <div class="seed-task-list">
            <For each={tasks()}>{(task) => <SeedTaskRow task={task} />}</For>
          </div>
        </Show>
      </Show>
    </div>
  )
}

function SeedTaskRow(props: { task: SeedTask }) {
  const running = () => props.task.status === 'running'
  const done = () => props.task.status === 'done'
  const showBar = () => isPlacement(props.task) && (props.task.bytesTotal ?? 0) > 0

  const stats = createMemo(() => {
    const task = props.task
    if (!isPlacement(task)) return ''
    const parts: string[] = []
    if ((task.bytesTotal ?? 0) > 0) {
      parts.push(
        done()
          ? formatByteSize(task.bytesTotal!)
          : `${formatByteSize(task.bytesTransferred ?? 0)} / ${formatByteSize(task.bytesTotal!)}`
      )
    }
    if (task.hardlinked) {
      // A hardlinked folder is instant and moves no bytes; a rate here would
      // read as absurd rather than fast.
      parts.push('hardlinked')
    } else {
      const rate = formatTransferRate(task.bytesPerSecond)
      if (rate && running()) parts.push(rate)
      const eta = formatEta(
        etaSeconds(task.bytesTransferred, task.bytesTotal, task.bytesPerSecond)
      )
      if (eta && running()) parts.push(`~${eta} left`)
    }
    if ((task.filesTotal ?? 0) > 0) {
      parts.push(`${shownFilesTransferred(task)}/${task.filesTotal} files`)
    }
    return parts.join(' · ')
  })

  return (
    <div class="seed-task">
      <div class="seed-task-top">
        <div class="seed-task-label">
          <span class="seed-task-kind">{kindLabel(props.task.kind)}</span>
          <Show when={props.task.trackerId}>
            {(id) => <Badge tone="neutral">{TRACKER_LABELS[id()] ?? id()}</Badge>}
          </Show>
          <span>{props.task.label.replace(/^(Transfer|Copy|Inject)\s+/, '')}</span>
        </div>
        <Badge tone={statusTone(props.task.status)}>{statusLabel(props.task.status)}</Badge>
      </div>

      <Show when={showBar()}>
        <ProgressBar
          value={shownBytesTransferred(props.task)}
          max={props.task.bytesTotal ?? 0}
          tone={done() ? 'success' : 'accent'}
        />
      </Show>

      <Show when={stats()}>
        <div class="mono seed-task-stats">{stats()}</div>
      </Show>

      <Show when={props.task.detail}>
        <div class="mono seed-task-detail">{props.task.detail}</div>
      </Show>
    </div>
  )
}

function kindLabel(kind: SeedTask['kind']): string {
  if (kind === 'transfer') return 'Transfer'
  if (kind === 'copy') return 'Copy'
  return 'Inject'
}

function phaseLabel(phase: string): string {
  switch (phase) {
    case 'running':
      return 'Seeding in progress'
    case 'done':
      return 'Seeding finished'
    case 'failed':
      return 'Seeding finished with errors'
    default:
      return 'Waiting to seed'
  }
}

function statusLabel(status: SeedTaskStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending'
    case 'running':
      return 'Running'
    case 'done':
      return 'Done'
    case 'failed':
      return 'Failed'
    case 'skipped':
      return 'Skipped'
  }
}

function statusTone(status: SeedTaskStatus): BadgeTone {
  switch (status) {
    case 'done':
      return 'success'
    case 'failed':
      return 'error'
    case 'running':
      return 'accent'
    case 'skipped':
      return 'warning'
    default:
      return 'neutral'
  }
}
