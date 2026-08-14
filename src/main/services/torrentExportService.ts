import { constants } from 'node:fs'
import { access, copyFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import type { TorrentExportResult, UploadSnapshot, UploadSubmission } from '@shared/types'

export interface TorrentExportServiceDeps {
  getUpload: () => UploadSnapshot
  pickSavePath: (filename: string) => Promise<string | null>
  pickDirectory: () => Promise<string | null>
}

export class TorrentExportService {
  constructor(private readonly deps: TorrentExportServiceDeps) {}

  async saveOne(submissionId: string): Promise<TorrentExportResult> {
    const submission = exportableSubmissions(this.deps.getUpload()).find(
      (item) => item.id === submissionId
    )
    if (!submission?.torrentPath) {
      return { ok: false, error: 'That torrent file is not available.' }
    }

    try {
      const destination = await this.deps.pickSavePath(basename(submission.torrentPath))
      if (!destination) return { ok: false, canceled: true }
      await access(submission.torrentPath)
      if (resolve(destination) !== resolve(submission.torrentPath)) {
        await copyFile(submission.torrentPath, destination)
      }
      return { ok: true, paths: [destination] }
    } catch (err) {
      return { ok: false, error: saveError(err) }
    }
  }

  async saveAll(): Promise<TorrentExportResult> {
    const submissions = exportableSubmissions(this.deps.getUpload())
    if (submissions.length === 0) {
      return { ok: false, error: 'No torrent files are available.' }
    }

    try {
      const directory = await this.deps.pickDirectory()
      if (!directory) return { ok: false, canceled: true }
      const files = submissions.map((submission) => ({
        source: submission.torrentPath!,
        destination: join(directory, basename(submission.torrentPath!))
      }))
      const duplicate = duplicateFilename(files.map((file) => basename(file.destination)))
      if (duplicate) {
        return { ok: false, error: `More than one torrent is named "${duplicate}".` }
      }
      for (const file of files) await access(file.source)
      for (const file of files) {
        try {
          await access(file.destination)
          return {
            ok: false,
            error: `A file named "${basename(file.destination)}" already exists in that folder.`
          }
        } catch {
          // The destination is free.
        }
      }
      for (const file of files) {
        await copyFile(file.source, file.destination, constants.COPYFILE_EXCL)
      }
      return { ok: true, paths: files.map((file) => file.destination) }
    } catch (err) {
      return { ok: false, error: saveError(err) }
    }
  }
}

function exportableSubmissions(upload: UploadSnapshot): UploadSubmission[] {
  return (upload.submissions ?? []).filter(
    (submission) => submission.status === 'done' && Boolean(submission.torrentPath)
  )
}

function duplicateFilename(filenames: string[]): string | null {
  const seen = new Set<string>()
  for (const filename of filenames) {
    const key = filename.toLocaleLowerCase()
    if (seen.has(key)) return filename
    seen.add(key)
  }
  return null
}

function saveError(err: unknown): string {
  if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
    return 'A torrent file or destination folder no longer exists.'
  }
  const detail = err instanceof Error ? err.message : String(err)
  return `Could not save the torrent file: ${detail}`
}
