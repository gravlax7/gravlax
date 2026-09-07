import { rm } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Config } from '@shared/types/config'
import type { NotifyPayload, Release } from '@shared/types'
import {
  acceptAppliedTags,
  beginFilesApply,
  beginFilesRestore,
  emptySeed,
  emptyTranscode,
  emptyUpload,
  failFilesApply,
  finishFilesApply,
  finishFilesNoop,
  finishFilesRestore,
  isKeepExistingSelection,
  markFilesDirty,
  setFilenameOverride,
  setPayloadNameOverride,
  setFolderNameOverride,
  setRenameReleaseFolder,
  setRenameTrackFiles,
  setRenameFlags,
  setFilesApplyProgress,
  setEmbeddedCoverArtCount,
  setStripEmbeddedCoverArt,
  setTagsCurrent,
  setTagsProposed,
  type State
} from '@main/core/uploadflow'
import {
  pendingSeparatorArtists,
  preserveSeparatorArtistChoices
} from '@shared/tags/editor'
import { invalidReleaseDateFields } from '@shared/tags/dates'
import { buildFilesRenamePlan, nextRenameFlagsForPathLimits } from '@shared/upload/naming'
import { sourceRestoreUnavailableMessage } from '@shared/upload/sourceRestore'
import { applyTagsAndRenames as writeTagsAndRenames } from '@main/core/tools/files/apply'
import { extractAlbumReleaseWithEmbeddedCoverArt } from '@main/core/tags/extract'
import { replaceWorkingCopyFromSource } from '@main/core/appdata/workspace'
import { discoverFLACFiles } from '@main/core/tools/flacFiles'
import { enumerateReleasePaths } from '@main/core/tools/releaseFiles'
import type { TaskSlot } from './taskSlot'
import type { ToolResolver } from '@main/core/tools/binaries'

export type FileChangeResult =
  | { ok: true }
  | { ok: false; error: string; needsConfirmation?: boolean }

export interface UploadSessionFileChangesContext {
  getState: () => State
  apply: (next: State, options?: { persist?: boolean }) => void
  persistNow: () => Promise<void>
  getConfig: () => Config
  tools: ToolResolver
  createWorkspaceGuard: (workspacePath: string) => () => boolean
  cancelGeneratedWork: () => void
  startTranscodeInspection: () => void
  runFileChecksAndWait: () => Promise<void>
  fileChecksNeedAttention: () => boolean
  goToFileChecks: () => void
  refreshSourceRestoreStatus: () => Promise<void>
  notify: (level: NotifyPayload['level'], message: string) => void
}

/** File writes form a transaction-like workflow and get their own coordinator. */
export class UploadSessionFileChanges {
  constructor(
    private readonly context: UploadSessionFileChangesContext,
    private readonly task: TaskSlot
  ) {}

  updateTagsProposed(release: Release): void {
    this.context.apply(markFilesDirty(setTagsProposed(this.context.getState(), release)))
  }

  setFilenameOverride(id: string, value?: string): void {
    this.assertUnlocked()
    this.context.apply(setFilenameOverride(this.context.getState(), id, value))
  }

  setPayloadNameOverride(id: string, value?: string): void {
    this.assertUnlocked()
    this.context.apply(setPayloadNameOverride(this.context.getState(), id, value))
  }

  setFolderNameOverride(value?: string): void {
    this.assertUnlocked()
    this.context.apply(setFolderNameOverride(this.context.getState(), value))
  }

  setRenameReleaseFolder(value: boolean): void {
    this.assertUnlocked()
    this.context.apply(setRenameReleaseFolder(this.context.getState(), value))
  }

  setRenameTrackFiles(value: boolean): void {
    this.assertUnlocked()
    this.context.apply(setRenameTrackFiles(this.context.getState(), value))
  }

  setStripEmbeddedCoverArt(value: boolean): void {
    this.assertUnlocked()
    this.context.apply(setStripEmbeddedCoverArt(this.context.getState(), value))
  }

  async applyTagsAndNames(confirmedWrites = false): Promise<FileChangeResult> {
    let stillCurrent = (): boolean => true
    try {
      let state = this.context.getState()
      if (state.files.apply.phase === 'applying' || state.files.apply.phase === 'restoring') {
        return { ok: false, error: 'File changes are already running.' }
      }
      if (state.tags.releaseStatus === 'loading') {
        return { ok: false, error: 'Metadata is still loading.' }
      }
      const release = state.tags.proposed
      const workspacePath = state.draft.workspacePath
      if (!workspacePath || !release) return this.fail('Tags are not ready.')
      if (pendingSeparatorArtists(release).length > 0) {
        return { ok: false, error: 'Choose how to read artist names that contain separators.' }
      }
      if (invalidReleaseDateFields(release.groupYear, release.year).length > 0) {
        return { ok: false, error: 'Dates must be YYYY, YYYY-MM, or YYYY-MM-DD.' }
      }
      stillCurrent = this.context.createWorkspaceGuard(workspacePath)
      const writeTags = !isKeepExistingSelection(state.metadata.selected)
      const naming = this.context.getConfig().naming
      const planInput = {
        release,
        files: state.files,
        naming,
        sourceMedia: state.draft.sourceMedia,
        encoding: state.transcode.inspection?.encoding,
        writeTags
      }
      const nextFlags = nextRenameFlagsForPathLimits(planInput)
      if (
        nextFlags.renameReleaseFolder !== state.files.apply.renameReleaseFolder ||
        nextFlags.renameTrackFiles !== state.files.apply.renameTrackFiles
      ) {
        this.context.apply(setRenameFlags(
          state,
          nextFlags.renameReleaseFolder,
          nextFlags.renameTrackFiles
        ))
        state = this.context.getState()
      }
      const plan = buildFilesRenamePlan({
        ...planInput,
        files: state.files
      })
      if (state.files.apply.appliedHash === plan.hash) {
        // A prior folder rename may have finished before navigation did. Make
        // sure its queued inspection is not left waiting when Continue retries.
        if (state.files.apply.phase !== 'applied') {
          this.context.apply({
            ...state,
            files: {
              ...state.files,
              apply: { ...state.files.apply, phase: 'applied', error: undefined }
            }
          })
        }
        this.context.startTranscodeInspection()
        return { ok: true }
      }
      this.assertUnlocked()
      if (plan.errors.length > 0) return this.fail(plan.errors[0]!)
      const renameFiles =
        plan.folderName !== basename(workspacePath) ||
        (plan.payloadFiles ?? plan.files).some((file) => file.changed)
      const stripCover = state.files.apply.stripEmbeddedCoverArt
      if (!writeTags && !renameFiles && !stripCover) {
        this.context.apply(finishFilesNoop(state, plan.hash))
        this.context.startTranscodeInspection()
        return { ok: true }
      }
      if (this.context.getConfig().workflow.confirmBeforeWrites && !confirmedWrites) {
        return { ok: false, error: 'Confirmation required.', needsConfirmation: true }
      }

      this.context.cancelGeneratedWork()
      const progressTotal =
        (writeTags || stripCover ? plan.files.length : 0) + (renameFiles ? 1 : 0)
      const reportProgress = (current: number, label: string): void => {
        if (!stillCurrent()) return
        this.context.apply(
          setFilesApplyProgress(this.context.getState(), current, progressTotal, label),
          { persist: false }
        )
      }
      this.context.apply(
        setFilesApplyProgress(
          beginFilesApply(state),
          0,
          progressTotal,
          fileChangeProgressLabel(writeTags, renameFiles, stripCover)
        ),
        { persist: false }
      )
      await this.context.persistNow()
      if (!stillCurrent()) return { ok: false, error: 'File changes were cancelled.' }

      let result: Awaited<ReturnType<typeof writeTagsAndRenames>> | undefined
      let operationError: unknown
      await this.task.run(
        async (handle) => {
          result = await writeTagsAndRenames({
            workspacePath,
            release,
            plan,
            writeTags,
            stripEmbeddedCoverArt: stripCover,
            signal: handle.signal,
            tools: this.context.tools,
            onProgress: (current, _total, label) => reportProgress(current, label)
          })
        },
        { guard: stillCurrent, onError: (error) => { operationError = error } }
      )
      if (operationError) throw operationError
      if (!result || !stillCurrent()) return { ok: false, error: 'File changes were cancelled.' }

      await this.invalidateGeneratedFiles()
      if (!stillCurrent()) return { ok: false, error: 'File changes were cancelled.' }
      let applied = writeTags ? release : (state.tags.current ?? release)
      let embeddedCoverArtCount = stripCover
        ? Math.max(0, (state.files.original.embeddedCoverArtCount ?? 0) - result.strippedPictureCount)
        : state.files.original.embeddedCoverArtCount
      try {
        const extracted = await extractAlbumReleaseWithEmbeddedCoverArt(result.workspacePath)
        applied = extracted.release
        embeddedCoverArtCount = extracted.embeddedCoverArtCount
        if (writeTags && release.artists) {
          applied.artists = release.artists.map((artist) => ({ ...artist }))
        }
        if (writeTags && (release.urls?.length ?? 0) > 0) {
          applied.urls = [...(release.urls ?? [])]
        }
        if (writeTags && release.cover) {
          applied.cover = release.cover
        }
        if (writeTags) {
          applied = preserveSeparatorArtistChoices(release, applied)
        }
      } catch {
        applied = writeTags ? release : (state.tags.current ?? release)
      }
      if (!stillCurrent()) return { ok: false, error: 'File changes were cancelled.' }
      let next = finishFilesApply(
        this.context.getState(),
        result.workspacePath,
        result.folderName,
        result.currentPaths,
        plan.hash,
        {
          changedFileCount: result.changedFileCount,
          strippedPictureCount: result.strippedPictureCount
        },
        result.payloadPaths
      )
      next = writeTags ? acceptAppliedTags(next, applied) : setTagsCurrent(next, applied)
      if (embeddedCoverArtCount !== undefined) {
        next = setEmbeddedCoverArtCount(next, embeddedCoverArtCount)
      }
      // Reading tags back and renaming paths changes the plan inputs. Save
      // their accepted state so revisiting Metadata does not repeat the writes.
      next.files.apply.appliedHash = buildFilesRenamePlan({
        ...planInput,
        release: next.tags.proposed ?? release,
        files: next.files
      }).hash
      this.context.apply(next)
      // Renaming the release folder changes workspacePath on purpose. Follow
      // that path so the guard does not treat our own rename as a source swap.
      stillCurrent = this.context.createWorkspaceGuard(result.workspacePath)
      await this.context.persistNow()
      if (!stillCurrent()) return { ok: false, error: 'File changes were cancelled.' }
      if (pendingSeparatorArtists(next.tags.proposed).length > 0) {
        const error = 'Choose how to read artist names that contain separators.'
        this.context.notify(
          'warning',
          'Files were applied. Choose how to read artist names that contain separators before continuing.'
        )
        return { ok: false, error }
      }
      this.context.startTranscodeInspection()
      this.context.notify('success', fileChangeSuccessMessage(writeTags, renameFiles, stripCover))
      return { ok: true }
    } catch (error) {
      if (!stillCurrent()) return { ok: false, error: 'File changes were cancelled.' }
      const message = String((error as Error).message ?? error)
      this.context.apply(failFilesApply(this.context.getState(), message))
      this.context.notify('error', message)
      return { ok: false, error: message }
    }
  }

  async revertFiles(): Promise<FileChangeResult> {
    let stillCurrent = (): boolean => true
    try {
      this.assertUnlocked()
      const state = this.context.getState()
      const phase = state.files.apply.phase
      if (
        !state.files.apply.onDiskModified &&
        phase !== 'failed' &&
        phase !== 'applying' &&
        phase !== 'restoring'
      ) return { ok: true }
      const workspacePath = state.draft.workspacePath
      const sourcePath = state.draft.sourcePath
      if (!workspacePath || !sourcePath) return { ok: false, error: 'Workspace is not ready.' }
      await this.context.refreshSourceRestoreStatus()
      const restore = this.context.getState().files.original
      if (!restore.restoreAvailable) {
        const message = sourceRestoreUnavailableMessage(restore.restoreUnavailableReason ?? 'unknown')
        this.context.apply(failFilesApply(this.context.getState(), message))
        this.context.notify('error', message)
        return { ok: false, error: message }
      }
      stillCurrent = this.context.createWorkspaceGuard(workspacePath)
      this.context.cancelGeneratedWork()
      this.context.apply(beginFilesRestore(this.context.getState()))
      await this.context.persistNow()
      if (!stillCurrent()) return { ok: false, error: 'Restore was cancelled.' }

      let restoredPath = ''
      let operationError: unknown
      await this.task.run(
        async (handle) => {
          restoredPath = await replaceWorkingCopyFromSource(
            workspacePath,
            sourcePath,
            (current, total, label) => {
              if (!stillCurrent() || handle.signal.aborted) return
              this.context.apply(
                setFilesApplyProgress(this.context.getState(), current, total, label),
                { persist: false }
              )
            }
          )
        },
        { guard: stillCurrent, onError: (error) => { operationError = error } }
      )
      if (operationError) throw operationError
      if (!restoredPath || !stillCurrent()) return { ok: false, error: 'Restore was cancelled.' }

      await this.invalidateGeneratedFiles()
      if (!stillCurrent()) return { ok: false, error: 'Restore was cancelled.' }
      const [files, payload, extracted] = await Promise.all([
        discoverFLACFiles(restoredPath),
        enumerateReleasePaths(restoredPath),
        extractAlbumReleaseWithEmbeddedCoverArt(restoredPath)
      ])
      if (!stillCurrent()) return { ok: false, error: 'Restore was cancelled.' }
      this.context.apply(
        setTagsCurrent(
          finishFilesRestore(
            this.context.getState(),
            restoredPath,
            basename(restoredPath),
            files.map((file) => file.relativePath),
            payload
          ),
          extracted.release
        )
      )
      this.context.apply(setEmbeddedCoverArtCount(this.context.getState(), extracted.embeddedCoverArtCount))
      stillCurrent = this.context.createWorkspaceGuard(restoredPath)
      await this.context.persistNow()
      if (!stillCurrent()) return { ok: false, error: 'Restore was cancelled.' }

      await this.context.runFileChecksAndWait()
      if (!stillCurrent()) return { ok: false, error: 'Restore was cancelled.' }
      this.context.apply({
        ...this.context.getState(),
        files: {
          ...this.context.getState().files,
          apply: {
            ...this.context.getState().files.apply,
            phase: 'idle',
            progressCurrent: undefined,
            progressTotal: undefined,
            progressLabel: undefined
          }
        }
      })
      if (this.context.fileChecksNeedAttention()) {
        this.context.goToFileChecks()
        this.context.notify(
          'warning',
          'The working copy was restored from the source folder. File checks need attention.'
        )
        return { ok: true }
      }
      this.context.startTranscodeInspection()
      this.context.notify('success', 'The working copy was restored from the source folder.')
      return { ok: true }
    } catch (error) {
      if (!stillCurrent()) return { ok: false, error: 'Restore was cancelled.' }
      const message = String((error as Error).message ?? error)
      this.context.apply(failFilesApply(this.context.getState(), message))
      this.context.notify('error', message)
      return { ok: false, error: message }
    }
  }

  private assertUnlocked(): void {
    const state = this.context.getState()
    const uploaded = (state.upload.submissions ?? []).some((item) => item.status === 'done')
    if (uploaded || state.upload.phase === 'submitting' || state.seed.phase !== 'idle') {
      throw new Error('Files cannot change after upload or seeding has started.')
    }
  }

  private fail(error: string): FileChangeResult {
    this.context.apply(failFilesApply(this.context.getState(), error))
    this.context.notify('error', error)
    return { ok: false, error }
  }

  private async invalidateGeneratedFiles(): Promise<void> {
    this.context.cancelGeneratedWork()
    const state = this.context.getState()
    for (const job of state.transcode.jobs ?? []) {
      if (job.outputPath) await rm(job.outputPath, { recursive: true, force: true })
    }
    this.context.apply({
      ...this.context.getState(),
      transcode: emptyTranscode(),
      upload: emptyUpload(),
      seed: emptySeed(),
      background: {
        ...this.context.getState().background,
        tasks: this.context.getState().background.tasks.map((task) =>
          task.id === 'transcode'
            ? {
                ...task,
                status: 'queued',
                detail: '',
                progressCurrent: 0,
                progressTotal: 0,
                progressLabel: ''
              }
            : task
        )
      }
    })
  }
}

function fileChangeProgressLabel(
  writeTags: boolean,
  renameFiles: boolean,
  stripCover: boolean
): string {
  if (writeTags) return renameFiles ? 'Applying tags and filenames…' : 'Applying tags…'
  if (stripCover) return renameFiles ? 'Removing cover art and renaming files…' : 'Removing cover art…'
  return 'Renaming files…'
}

function fileChangeSuccessMessage(
  writeTags: boolean,
  renameFiles: boolean,
  stripCover: boolean
): string {
  const changes = [
    writeTags ? 'tags' : '',
    renameFiles ? 'filenames' : '',
    stripCover ? 'embedded cover art' : ''
  ].filter(Boolean)
  if (changes.length === 1) return `${capitalize(changes[0]!)} changed.`
  return `${capitalize(changes.slice(0, -1).join(', '))} and ${changes.at(-1)} changed.`
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`
}
