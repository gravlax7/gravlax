import { join } from 'node:path'
import type { Config } from '@shared/types/config'
import type {
  UploadFormatPayload,
  UploadSnapshot,
  UploadSubmission,
  UploadTrackerId
} from '@shared/types'
import { uploadWorkspaceRootForPath } from '@main/core/appdata/workspace'
import { createTrackers, type Tracker } from '@main/core/tools/trackers'
import {
  createTorrent,
  torrentFileName,
  withComment,
  writeTorrentFile,
  type TorrentMeta
} from '@main/core/tools/torrent/createTorrent'
import { buildTrackerUploadData, collectLogFiles } from '@main/core/tools/upload/payload'
import {
  buildLossyMasterComment,
  wrapTranscodeLossyComment
} from '@main/core/tools/upload/descriptions'

const TRACKER_NAMES: Record<UploadTrackerId, string> = {
  redacted: 'Redacted',
  orpheus: 'Orpheus'
}

const TRACKER_SOURCES: Record<UploadTrackerId, string> = {
  redacted: 'RED',
  orpheus: 'OPS'
}

export function submissionId(trackerId: UploadTrackerId, formatId: string): string {
  return `${trackerId}:${formatId}`
}

/** One row per (tracker × format), in the order they will be uploaded. */
export function planSubmissions(upload: UploadSnapshot): UploadSubmission[] {
  const submissions: UploadSubmission[] = []
  for (const trackerId of upload.selectedTrackerIds ?? []) {
    for (const format of upload.formats ?? []) {
      submissions.push({
        id: submissionId(trackerId, format.id),
        trackerId,
        formatId: format.id,
        label: `${TRACKER_NAMES[trackerId]} · ${format.label}`,
        status: 'pending'
      })
    }
  }
  return submissions
}

export interface RunSubmissionsOptions {
  cfg: Config
  upload: UploadSnapshot
  submissions: UploadSubmission[]
  workspacePath: string
  lossyMaster: boolean
  lossyComment: string
  sourceUrl: string
  spectralBbcode: string
  signal?: AbortSignal
  /** False once the workspace or session moved on; stops before any further writes. */
  fresh: () => boolean
  onPatch: (id: string, patch: Partial<UploadSubmission>) => void
  /** Awaited after each success so a crash cannot lose the record of a live torrent. */
  onCommit: () => Promise<void>
  /** Records the confirmed tracker upload in durable application statistics. */
  onSuccess: (submission: UploadSubmission) => Promise<void>
  onGroupId: (trackerId: UploadTrackerId, groupId: number) => void
}

export async function runSubmissions(options: RunSubmissionsOptions): Promise<void> {
  const { cfg, upload, submissions, signal, fresh, onPatch, onCommit, onGroupId } = options
  const trackers = new Map(createTrackers(cfg).map((t) => [t.id as UploadTrackerId, t]))
  const formats = new Map((upload.formats ?? []).map((f) => [f.id, f]))
  const groupIds = new Map<UploadTrackerId, number>()

  for (const [trackerId, existing] of Object.entries(upload.groupIds ?? {})) {
    if (typeof existing === 'number' && Number.isFinite(existing)) {
      groupIds.set(trackerId as UploadTrackerId, existing)
    }
  }

  for (const trackerId of upload.selectedTrackerIds ?? []) {
    const pending = submissions.filter(
      (sub) => sub.trackerId === trackerId && sub.status !== 'done'
    )
    if (pending.length === 0) continue

    const tracker = trackers.get(trackerId)
    if (!tracker) {
      for (const sub of pending) {
        onPatch(sub.id, { status: 'failed', error: `${TRACKER_NAMES[trackerId]} is not configured.` })
      }
      continue
    }

    try {
      await tracker.client.authenticate(signal)
    } catch (err) {
      const message = errorText(err)
      for (const sub of pending) {
        onPatch(sub.id, { status: 'failed', error: `Sign-in failed: ${message}` })
      }
      continue
    }
    if (!fresh()) return

    for (const submission of pending) {
      if (!fresh()) return
      const format = formats.get(submission.formatId)
      if (!format) {
        onPatch(submission.id, { status: 'failed', error: 'Format is no longer prepared.' })
        continue
      }

      try {
        const groupId = groupIds.get(trackerId)
        const result = await uploadOneFormat({
          ...options,
          tracker,
          trackerId,
          format,
          submission,
          groupId
        })
        if (!fresh()) return

        onPatch(submission.id, result.patch)
        if (result.groupId) {
          groupIds.set(trackerId, result.groupId)
          onGroupId(trackerId, result.groupId)
        }
        await onCommit()
        await options.onSuccess(submission)
      } catch (err) {
        if (!fresh()) return
        onPatch(submission.id, { status: 'failed', error: errorText(err) })
        // Stop this tracker: the group this format would have created or joined
        // is now unknown, and pressing on would risk a duplicate group.
        for (const later of pending.slice(pending.indexOf(submission) + 1)) {
          onPatch(later.id, {
            status: 'failed',
            error: `Skipped after ${format.label} failed.`
          })
        }
        break
      }
    }
  }
}

interface UploadOneOptions extends RunSubmissionsOptions {
  tracker: Tracker
  trackerId: UploadTrackerId
  format: UploadFormatPayload
  submission: UploadSubmission
  groupId?: number
}

async function uploadOneFormat(
  options: UploadOneOptions
): Promise<{ patch: Partial<UploadSubmission>; groupId?: number }> {
  const { cfg, upload, tracker, trackerId, format, submission, groupId, signal } = options

  options.onPatch(submission.id, { status: 'running', error: undefined })

  const source = TRACKER_SOURCES[trackerId]
  const torrentPath =
    submission.torrentPath ??
    join(torrentDirectory(cfg, options.workspacePath), torrentFileName(format.folderPath, source))

  const torrent = await createTorrent({
    folderPath: format.folderPath,
    announceUrl: tracker.client.announce,
    source,
    createdBy: `create-torrent`,
    signal
  })
  await writeTorrentFile(torrent.meta, torrentPath)
  if (!options.fresh()) return { patch: {} }

  options.onPatch(submission.id, { torrentPath, infoHash: torrent.infoHash })

  const data = buildTrackerUploadData({ upload, format, trackerId, groupId })
  const logFiles = await collectLogFiles(format.folderPath, format.logfileNames ?? [])
  const result = await tracker.upload(data, { torrentData: torrent.data, logFiles }, signal)

  await rewriteTorrentComment(torrent.meta, torrentPath, tracker.client.torrentUrl(result.torrentId))

  const lossyReport = await reportLossyIfNeeded(options, result.torrentId)

  return {
    patch: {
      status: 'done',
      torrentPath,
      infoHash: torrent.infoHash,
      torrentId: result.torrentId,
      groupId: result.groupId,
      url: tracker.client.torrentUrl(result.torrentId),
      lossyReport,
      error: undefined
    },
    groupId: result.groupId || undefined
  }
}

async function reportLossyIfNeeded(
  options: UploadOneOptions,
  torrentId: number
): Promise<UploadSubmission['lossyReport']> {
  if (!options.lossyMaster) return 'not-needed'

  const isTranscode = options.format.id !== 'source'
  const base = buildLossyMasterComment({
    comment: options.lossyComment,
    spectralBbcode: options.spectralBbcode
  })
  const comment = isTranscode
    ? wrapTranscodeLossyComment(options.sourceUrl || options.format.folderPath, base)
    : base

  try {
    await options.tracker.reportLossyMaster(
      torrentId,
      comment,
      options.upload.media ?? '',
      options.signal
    )
    return 'done'
  } catch {
    // The torrent is already up; a failed report is worth flagging but is not a
    // reason to call the upload itself a failure.
    return 'failed'
  }
}

/** The permalink only exists after the upload, so the file is written twice. */
async function rewriteTorrentComment(
  meta: TorrentMeta,
  torrentPath: string,
  url: string
): Promise<void> {
  try {
    await writeTorrentFile(withComment(meta, url), torrentPath)
  } catch {
    // Cosmetic: the torrent on disk is already valid and identical bar the
    // comment, and the upload has landed.
  }
}

/**
 * Falls back to the workspace root — beside the release copy, never inside it.
 * A .torrent written into the folder would end up in the next torrent built
 * from it, and would be shipped to the seedbox as part of the release.
 */
function torrentDirectory(cfg: Config, workspacePath: string): string {
  const configured = cfg.directories.torrents.trim()
  if (configured) return configured
  return uploadWorkspaceRootForPath(workspacePath)
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
