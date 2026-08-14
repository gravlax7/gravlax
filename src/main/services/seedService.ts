import { readFile } from 'node:fs/promises'
import path from 'node:path'
import type { Config } from '@shared/types/config'
import type {
  SeedFormatInput,
  SeedSnapshot,
  SeedTask,
  SeedTorrentInput,
  UploadSnapshot,
  UploadTrackerId
} from '@shared/types'
import {
  createQBittorrentClient,
  resolveTorrentSavePath,
  type QBittorrentTorrent
} from '@main/core/tools/torrentClient'
import {
  copyFolderForSeeding,
  createRateMeter,
  uploadFolderViaSftp,
  type TransferProgress
} from '@main/core/tools/transfer'
import { cloneSeed, emptySeed, patchSeedTask } from '@main/core/uploadflow/seed'

export type SeedProgressCallback = (seed: SeedSnapshot) => void

export interface RunSeedOptions {
  cfg: Config
  formats: SeedFormatInput[]
  /** Tasks from a previous run; anything already `done` is not repeated. */
  previousTasks?: SeedTask[]
  onProgress?: SeedProgressCallback
  signal?: AbortSignal
}

/** One placement per uploaded format, with each tracker torrent for that folder. */
export function seedFormatsFromUpload(upload: UploadSnapshot): SeedFormatInput[] {
  const succeeded = (upload.submissions ?? []).filter((submission) => submission.status === 'done')
  // A done row is a torrent confirmed on the tracker. Without its torrent data
  // the placement below would be silently dropped and a live torrent would
  // never be seeded; fail loudly instead.
  const incomplete = succeeded.filter(
    (submission) => !submission.torrentPath || !submission.infoHash
  )
  if (incomplete.length > 0) {
    throw new Error(
      `seedFormatsFromUpload: done submission(s) missing torrent data: ${incomplete
        .map((submission) => submission.id)
        .join(', ')}`
    )
  }
  const formats: SeedFormatInput[] = []
  for (const format of upload.formats ?? []) {
    const torrents = succeeded
      .filter(
        (submission) =>
          submission.formatId === format.id && submission.torrentPath && submission.infoHash
      )
      .map((submission) => ({
        trackerId: submission.trackerId,
        torrentPath: submission.torrentPath!,
        infoHash: submission.infoHash!
      }))
    if (torrents.length === 0) continue
    formats.push({ id: format.id, label: format.label, folderPath: format.folderPath, torrents })
  }
  return formats
}

/**
 * SFTP reports progress per chunk and every emit clones the whole snapshot, so
 * an unthrottled transfer spends more time rebuilding state than moving bytes.
 */
const PROGRESS_INTERVAL_MS = 250

// qBittorrent accepts the add before its torrent list always reflects it.
// Keep the quick first check, then allow the client time to finish the add.
const TORRENT_LOOKUP_RETRY_MS = [250, 500, 1_000, 2_000, 4_000]

const TRACKER_LABELS: Record<UploadTrackerId, string> = {
  redacted: 'RED',
  orpheus: 'OPS'
}

export function transferTaskId(formatId: string): string {
  return `transfer:${formatId}`
}

export function copyTaskId(formatId: string): string {
  return `copy:${formatId}`
}

export function injectTaskId(formatId: string, trackerId: UploadTrackerId): string {
  return `inject:${formatId}:${trackerId}`
}

export async function runSeed(options: RunSeedOptions): Promise<SeedSnapshot> {
  const { cfg, formats, onProgress, signal } = options
  let seed = buildInitialSeed(cfg, formats, options.previousTasks)
  const emit = (next: SeedSnapshot): void => {
    seed = cloneSeed(next)
    onProgress?.(seed)
  }
  emit({ ...seed, phase: 'running', error: undefined })

  if (formats.length === 0 || seed.tasks.length === 0) {
    emit({ ...seed, phase: 'done', error: undefined })
    return seed
  }

  for (const format of formats) {
    throwIfAborted(signal)
    await placeFormat(format)
  }

  await injectTorrents()

  const failed = seed.tasks.some((t) => t.status === 'failed')
  emit({
    ...seed,
    phase: failed ? 'failed' : 'done',
    error: failed ? 'One or more seed tasks failed' : undefined
  })
  return seed

  /** Gets the release data where the torrent client can find it. */
  async function placeFormat(format: SeedFormatInput): Promise<void> {
    const task = seed.tasks.find(
      (t) => t.id === transferTaskId(format.id) || t.id === copyTaskId(format.id)
    )
    if (!task || task.status === 'done') return

    const rate = createRateMeter()
    let lastEmit = 0
    let latestProgress: TransferProgress | undefined
    const report = (progress: TransferProgress, force = false): void => {
      latestProgress = progress
      const now = Date.now()
      if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return
      lastEmit = now
      emit(
        patchSeedTask(seed, task.id, {
          status: 'running',
          bytesTransferred: progress.bytesTransferred,
          bytesTotal: progress.bytesTotal,
          bytesPerSecond: rate.sample(progress.bytesTransferred, now),
          filesTransferred: progress.filesTransferred,
          filesTotal: progress.filesTotal,
          detail: progress.currentFile
        })
      )
    }

    emit(patchSeedTask(seed, task.id, { status: 'running', detail: 'Starting…' }))
    try {
      if (task.kind === 'transfer') {
        await uploadFolderViaSftp(cfg.transfer, {
          localFolder: format.folderPath,
          remoteFolder: cfg.transfer.remotePath.trim(),
          signal,
          onProgress: (progress) => report(progress)
        })
        emit(
          patchSeedTask(seed, task.id, {
            status: 'done',
            bytesTransferred: latestProgress?.bytesTotal,
            bytesTotal: latestProgress?.bytesTotal,
            bytesPerSecond: undefined,
            filesTransferred: latestProgress?.filesTotal,
            filesTotal: latestProgress?.filesTotal,
            detail: path.basename(format.folderPath)
          })
        )
        return
      }

      const result = await copyFolderForSeeding(format.folderPath, cfg.directories.seeding.trim(), {
        signal,
        onProgress: (progress) => report(progress)
      })
      emit(
        patchSeedTask(seed, task.id, {
          status: 'done',
          hardlinked: result.hardlinked,
          bytesTransferred: result.bytesTotal,
          bytesTotal: result.bytesTotal,
          bytesPerSecond: undefined,
          filesTransferred: result.fileCount,
          filesTotal: result.fileCount,
          detail: result.destination
        })
      )
    } catch (err) {
      emit(
        patchSeedTask(seed, task.id, {
          status: 'failed',
          bytesPerSecond: undefined,
          detail: err instanceof Error ? err.message : String(err)
        })
      )
    }
  }

  async function injectTorrents(): Promise<void> {
    const injectTasks = seed.tasks.filter((t) => t.kind === 'inject' && t.status !== 'done')
    if (!cfg.torrentClient.enabled || injectTasks.length === 0) return

    // null means Automatic Torrent Management owns the location; '' means we
    // are meant to pin one but none is configured, which would silently land
    // the torrent in qBittorrent's global default directory.
    const savePath = resolveTorrentSavePath(cfg)
    if (savePath === '') {
      for (const task of injectTasks) {
        emit(
          patchSeedTask(seed, task.id, {
            status: 'failed',
            detail: cfg.transfer.enabled
              ? 'Save path and seedbox remote path are both empty'
              : 'Save path and seeding folder are both empty'
          })
        )
      }
      return
    }

    let client: ReturnType<typeof createQBittorrentClient>
    try {
      client = createQBittorrentClient(cfg.torrentClient)
      await client.login()
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      for (const task of injectTasks) {
        emit(patchSeedTask(seed, task.id, { status: 'failed', detail }))
      }
      return
    }

    for (const task of injectTasks) {
      throwIfAborted(signal)
      const found = findTorrentForTask(task.id)
      if (!found) continue
      const { format, torrent } = found

      // Injecting after a failed transfer points qBittorrent at a folder that
      // is missing or half-written; it would either error or start
      // re-downloading the release we just tried to upload.
      const placement = seed.tasks.find(
        (t) => t.id === transferTaskId(format.id) || t.id === copyTaskId(format.id)
      )
      if (placement && placement.status !== 'done') {
        emit(
          patchSeedTask(seed, task.id, {
            status: 'skipped',
            detail: placement.kind === 'copy' ? 'Copy did not complete' : 'Transfer did not complete'
          })
        )
        continue
      }

      emit(patchSeedTask(seed, task.id, { status: 'running', detail: 'Adding to qBittorrent…' }))
      try {
        const data = new Uint8Array(await readFile(torrent.torrentPath))
        await client.addTorrent(data, {
          savePath,
          category: cfg.torrentClient.category.trim() || undefined,
          paused: cfg.torrentClient.startPaused,
          filename: path.basename(torrent.torrentPath)
        })

        const added = await waitForTorrent(client, torrent.infoHash, signal)
        if (!added) {
          // The add endpoint answers "Ok." even when the client drops the
          // torrent, so an unverified add is a failure, not a success.
          emit(
            patchSeedTask(seed, task.id, {
              status: 'failed',
              detail: 'qBittorrent accepted the request but does not have the torrent'
            })
          )
          continue
        }
        emit(patchSeedTask(seed, task.id, { status: 'done', detail: describeAdded(added, savePath) }))
      } catch (err) {
        emit(
          patchSeedTask(seed, task.id, {
            status: 'failed',
            detail: err instanceof Error ? err.message : String(err)
          })
        )
      }
    }
  }

  function findTorrentForTask(
    taskId: string
  ): { format: SeedFormatInput; torrent: SeedTorrentInput } | null {
    for (const format of formats) {
      for (const torrent of format.torrents) {
        if (injectTaskId(format.id, torrent.trackerId) === taskId) return { format, torrent }
      }
    }
    return null
  }

  function describeAdded(added: QBittorrentTorrent, savePath: string | null): string {
    const parts = [added.name || 'added', added.state].filter(Boolean)
    const location = added.savePath || savePath
    if (location) parts.push(location)
    else if (added.category) parts.push(`category: ${added.category}`)
    else parts.push('managed by qBittorrent')
    return parts.join(' · ')
  }
}

export function buildInitialSeed(
  cfg: Config,
  formats: SeedFormatInput[],
  previousTasks: SeedTask[] = []
): SeedSnapshot {
  if (formats.length === 0) return emptySeed()

  const previous = new Map(previousTasks.map((task) => [task.id, task]))
  // A completed multi-GB transfer must survive a retry of the inject that
  // failed after it.
  const carry = (task: SeedTask): SeedTask => {
    const before = previous.get(task.id)
    return before?.status === 'done' ? { ...before } : task
  }

  const transferEnabled = cfg.transfer.enabled
  const seedingFolder = cfg.directories.seeding.trim()
  const tasks: SeedTask[] = []

  for (const format of formats) {
    if (transferEnabled) {
      tasks.push(
        carry({
          id: transferTaskId(format.id),
          kind: 'transfer',
          label: `Transfer ${format.label}`,
          status: 'pending'
        })
      )
    } else if (seedingFolder !== '') {
      tasks.push(
        carry({
          id: copyTaskId(format.id),
          kind: 'copy',
          label: `Copy ${format.label}`,
          status: 'pending'
        })
      )
    }
  }

  if (cfg.torrentClient.enabled) {
    for (const format of formats) {
      for (const torrent of format.torrents) {
        tasks.push(
          carry({
            id: injectTaskId(format.id, torrent.trackerId),
            kind: 'inject',
            trackerId: torrent.trackerId,
            label: `Inject ${format.label} (${TRACKER_LABELS[torrent.trackerId]})`,
            status: 'pending'
          })
        )
      }
    }
  }

  if (tasks.length === 0) {
    return { phase: 'idle', tasks: [], error: undefined }
  }
  return { phase: 'idle', tasks }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Seed aborted')
}

async function waitForTorrent(
  client: ReturnType<typeof createQBittorrentClient>,
  infoHash: string,
  signal?: AbortSignal
): Promise<QBittorrentTorrent | null> {
  let added = await client.getTorrent(infoHash)
  for (const waitMs of TORRENT_LOOKUP_RETRY_MS) {
    if (added) return added
    await delay(waitMs, signal)
    added = await client.getTorrent(infoHash)
  }
  return added
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    const abort = (): void => {
      clearTimeout(timer)
      reject(new Error('Seed aborted'))
    }
    signal.addEventListener('abort', abort, { once: true })
  })
}
