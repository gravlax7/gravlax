import { For, Show, createMemo, createSignal } from 'solid-js'
import type { Config } from '@shared/types/config'
import type {
  SeedTask,
  SeedTaskStatus,
  UploadFlowStateJSON,
  UploadSubmission
} from '@shared/types'
import { etaSeconds, formatByteSize, formatEta, formatTransferRate } from '@shared/format'
import { TrackerIcon } from '../../../components/TrackerIcon'
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
  config: Config
  onRetry: () => void
}) {
  const seed = createMemo(() => props.state.seed ?? { phase: 'idle' as const, tasks: [] })
  const tasks = createMemo(() => seed().tasks ?? [])
  const phase = createMemo(() => seed().phase ?? 'idle')
  const uploadDone = createMemo(() => props.state.upload?.phase === 'done')
  const hasCompleted = createMemo(() => tasks().some((t) => t.status === 'done'))
  const torrents = createMemo(() =>
    (props.state.upload?.submissions ?? []).filter(
      (submission) => submission.status === 'done' && Boolean(submission.torrentPath)
    )
  )
  const torrentFolder = createMemo(() => props.config.directories.torrents.trim())
  const clientSavePath = createMemo(() => {
    const explicit = props.config.torrentClient.savePath.trim()
    if (explicit) return explicit
    return props.config.transfer.enabled
      ? props.config.transfer.remotePath.trim()
      : props.config.directories.seeding.trim()
  })
  const [saving, setSaving] = createSignal<string | null>(null)
  const [copiedSubmission, setCopiedSubmission] = createSignal<string | null>(null)
  const [saveMessage, setSaveMessage] = createSignal<{
    tone: 'info' | 'error'
    text: string
  } | null>(null)

  const saveOne = async (submission: UploadSubmission): Promise<void> => {
    setSaving(submission.id)
    setSaveMessage(null)
    const result = await window.gravlax.upload.saveTorrent(submission.id)
    setSaving(null)
    if (!result.ok) {
      if ('canceled' in result) return
      setSaveMessage({ tone: 'error', text: result.error })
      return
    }
    setSaveMessage({ tone: 'info', text: `Saved ${fileName(result.paths[0] ?? '')}.` })
  }

  const saveAll = async (): Promise<void> => {
    setSaving('all')
    setSaveMessage(null)
    const result = await window.gravlax.upload.saveTorrents()
    setSaving(null)
    if (!result.ok) {
      if ('canceled' in result) return
      setSaveMessage({ tone: 'error', text: result.error })
      return
    }
    setSaveMessage({
      tone: 'info',
      text: `Saved ${result.paths.length} torrent file${result.paths.length === 1 ? '' : 's'}.`
    })
  }

  const copyDataPath = async (submissionId: string, path: string): Promise<void> => {
    try {
      await window.gravlax.clipboard.writeText(path)
      setCopiedSubmission(submissionId)
      window.setTimeout(() => {
        if (copiedSubmission() === submissionId) setCopiedSubmission(null)
      }, 2000)
    } catch (err) {
      setSaveMessage({
        tone: 'error',
        text: err instanceof Error ? err.message : 'Could not copy the path.'
      })
    }
  }

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
            {torrents().length > 0
              ? 'No automatic placement is configured. The release data remains in the working copy.'
              : 'Seedbox, seeding folder and torrent client are all off, or no torrents were created.'}
          </Callout>
        </Show>

        <Show when={tasks().length > 0}>
          <div class="seed-task-list">
            <For each={tasks()}>{(task) => <SeedTaskRow task={task} />}</For>
          </div>
        </Show>

        <Show when={torrents().length > 0}>
          <section class="seed-torrents">
            <div class="seed-torrents-header">
              <div>
                <div class="seed-torrents-title">Torrent files</div>
                <div class="seed-torrents-help">Save or reveal the generated .torrent files.</div>
              </div>
              <div class="seed-torrents-header-actions">
                <Show when={torrentFolder()}>
                  {(folder) => (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void window.gravlax.shell.openPath(folder())}
                    >
                      <Icon name="folder" size={14} />
                      Open folder
                    </Button>
                  )}
                </Show>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={saving() === 'all'}
                  disabled={saving() !== null}
                  onClick={() => void saveAll()}
                >
                  <Icon name="download" size={14} />
                  Save all
                </Button>
              </div>
            </div>

            <Show when={!props.config.torrentClient.enabled}>
              <Callout tone="info">
                Add each .torrent file to your client. When asked for a save location, select the
                matching client save location shown below—not the .torrent file folder. You can still
                finish this upload now.
              </Callout>
            </Show>

            <div class="seed-torrent-list">
              <For each={torrents()}>
                {(submission) => (
                  <div class="seed-torrent-row">
                    <div class="seed-torrent-main">
                      <div class="seed-torrent-label">
                        <TrackerIcon trackerId={submission.trackerId} size={18} alt="" />
                        <span>{submission.label}</span>
                      </div>
                      <div class="mono seed-torrent-path" title={submission.torrentPath}>
                        Torrent file: {submission.torrentPath}
                      </div>
                      <Show when={clientSavePath()}>
                        {(value) => (
                          <div class="seed-torrent-data">
                            <div class="mono seed-torrent-path" title={value()}>
                              Client save location: {value()}
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void copyDataPath(submission.id, value())}
                            >
                              <Show when={copiedSubmission() === submission.id}>
                                <Icon name="check" size={14} />
                              </Show>
                              {copiedSubmission() === submission.id ? 'Copied' : 'Copy path'}
                            </Button>
                          </div>
                        )}
                      </Show>
                    </div>
                    <div class="seed-torrent-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        loading={saving() === submission.id}
                        disabled={saving() !== null}
                        onClick={() => void saveOne(submission)}
                      >
                        <Icon name="download" size={14} />
                        Save as
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() =>
                          void window.gravlax.shell.revealPath(submission.torrentPath!)
                        }
                      >
                        Reveal
                      </Button>
                    </div>
                  </div>
                )}
              </For>
            </div>

            <Show when={saveMessage()}>
              {(message) => <Callout tone={message().tone}>{message().text}</Callout>}
            </Show>
          </section>
        </Show>
      </Show>
    </div>
  )
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || 'torrent file'
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
            {(id) => (
              <span class="seed-task-tracker">
                <TrackerIcon trackerId={id()} size={18} alt="" />
                <Badge tone="neutral">{TRACKER_LABELS[id()] ?? id()}</Badge>
              </span>
            )}
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
