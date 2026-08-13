import { access, rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { Config } from '@shared/types/config'
import type {
  MetadataSelection,
  MetadataUrlResolution,
  NotifyPayload,
  Release,
  SeedSnapshot,
  SourceMedia,
  TrackerGroupDetail,
  TrackerGroupSearchSnapshot,
  TranscodeJobResult,
  UploadFlowStateJSON,
  UploadStartEntries,
  UploadSnapshot,
  UploadTrackerId
} from '@shared/types'
import {
  clearMetadataSelection,
  clearFilesCheck,
  clearTagsRelease,
  markBackgroundTaskCompleted,
  markBackgroundTaskFailed,
  markBackgroundTaskProgress,
  markBackgroundTaskRunning,
  resetBackgroundTask,
  selectSourcePath,
  setCurrentStep,
  setFilesCheck,
  setFilesCheckRunning,
  setLossyComment,
  setLossyMaster,
  setSpectralIds,
  setDefaultSpectralIds,
  setSourceMedia,
  setMetadataBaseline,
  setMetadataProviders,
  setMetadataSelection,
  setTagsCursor,
  setTagsCurrent,
  setTagsCurrentFailed,
  setTagsCurrentLoading,
  setTagsProposed,
  setTagsRelease,
  setTagsReleaseFailed,
  setTagsReleaseLoading,
  setTagsReleaseManual,
  setTranscodeEssentialOnly,
  setTranscodeInspection,
  setTranscodeJobs,
  setTranscodePhase,
  setTranscodeSelection,
  updateTranscodeJob,
  setWorkspacePath,
  restoreState,
  newState,
  stepIndex,
  type State,
  task as getTask,
  ensureUploadReport,
  hostCoverImageForSubmit,
  updateUploadReport,
  setGroupSearch,
  beginSubmit,
  failUploadReport,
  finishSubmit,
  patchSubmission,
  setSpectralBbcode,
  searchTrackerGroups,
  fetchTorrentGroupDetail,
  resolveTorrentIdToGroupId,
  groupSearchRequest,
  setSeed,
  initializeFiles,
  setEmbeddedCoverArtCount,
} from '@main/core/uploadflow'
import { runSeed, seedFormatsFromUpload } from '@main/services/seedService'
import { planSubmissions, runSubmissions } from '@main/services/uploadSubmit'
import { hostSpectralsForUpload } from '@main/core/tools/upload/spectralHosting'
import {
  pendingUploadTrackerIds,
  validateTrackerHealth,
  validatePreparedUploadFormats,
  validateSelectedTranscodes,
  validateUploadReport,
  validateUploadTargets
} from '@shared/upload/validation'
import { healthcheckTrackers } from '@main/core/tools/trackers/health'
import {
  convertFolder,
  inspectTranscode,
  transcodeFolder
} from '@main/core/tools/transcode'
import {
  copyFolderToUploadWorkspace,
  readUploadFlow,
  readUploadWorkspaceSource,
  removeUploadWorkspace,
  uploadWorkspaceBelongsToUserData,
  uploadWorkspaceRootForPath,
  clearWorkspace,
  workspaceSize
} from '@main/core/appdata/workspace'
import { saveUploadedRelease } from '@main/core/appdata/uploadHistory'
import { generateSpectrals, listSpectralPairs } from '@main/core/tools/spectrals/generate'
import {
  compressSpectralPngs,
  type SpectralCompressionResult
} from '@main/core/tools/spectrals/compress'
import { spectralIdsForRelease } from '@shared/upload/spectralIds'
import { checkMQAWorkspace, mqaSummaryDetail } from '@main/core/tools/diagnostics/workspace'
import {
  checkLogsWorkspace,
  logcheckerSummaryDetail
} from '@main/core/tools/diagnostics/logchecker'
import { detectSourceMedia } from '@main/core/tools/diagnostics/sourceMedia'
import { createEnabledTrackers } from '@main/core/tools/trackers'
import { extractAlbumReleaseWithEmbeddedCoverArt } from '@main/core/tags/extract'
import { discoverFLACFiles } from '@main/core/tools/flacFiles'
import { buildFilesRenamePlan } from '@shared/upload/naming'
import { METADATA_PROVIDER_MANUAL } from '@shared/types/upload'
import { isNamedMainArtist } from '@shared/upload/artists'
import { APP_VERSION } from '@shared/version'
import { TaskScope, isAbortError, type TaskHandle } from '@main/services/taskSlot'
import { UploadSessionRuntime, type UploadSessionRuntimeDeps } from '@main/services/uploadSessionRuntime'
import { UploadSessionFileChanges } from '@main/services/uploadSessionFileChanges'
import { evaluateStepNavigation } from '@shared/upload/workflow'
import { listUploadStartEntries } from '@main/services/uploadStartService'
import type { UploadStatsRecord } from '@main/services/uploadStatsService'
import type { ToolResolver } from '@main/core/tools/binaries'

const FILES_CHECK_STEP = stepIndex('files-check') ?? 0

export interface UploadSessionDeps extends UploadSessionRuntimeDeps {
  recordUploadStatistic?: (record: UploadStatsRecord) => Promise<void>
  optimizeSpectralPngs?: typeof compressSpectralPngs
  tools: ToolResolver
}

export class UploadSession {
  private readonly runtime: UploadSessionRuntime
  private tasks = new TaskScope()
  private spectrals = this.tasks.slot('spectrals')
  private spectralOptimization = this.tasks.slot('spectral-optimization')
  private filesCheck = this.tasks.slot('files-check')
  private metadata = this.tasks.slot('metadata')
  private tags = this.tasks.slot('tags')
  private transcode = this.tasks.slot('transcode')
  private tagsCurrent = this.tasks.slot('tags-current')
  private groupSearch = this.tasks.slot('group-search')
  private submit = this.tasks.slot('submit')
  private seed = this.tasks.slot('seed')
  private fileChanges = this.tasks.slot('file-changes')
  private spectralOptimizationPromise: Promise<void> = Promise.resolve()
  private spectralOptimizationKey = ''
  private checkedSpectralPaths = new Set<string>()
  private readonly fileChangesService: UploadSessionFileChanges

  constructor(private readonly deps: UploadSessionDeps) {
    this.runtime = new UploadSessionRuntime(deps)
    this.fileChangesService = new UploadSessionFileChanges(
      {
        getState: () => this.state,
        apply: (next, options) => this.apply(next, options),
        persistNow: () => this.persistNow(),
        getConfig: () => this.deps.getConfig(),
        tools: this.deps.tools,
        createWorkspaceGuard: (workspacePath) => {
          const generation = this.tasks.generation
          return () => this.stillOnWorkspace(generation, workspacePath)
        },
        cancelGeneratedWork: () => {
          this.transcode.cancel()
          this.groupSearch.cancel()
        },
        startTranscodeInspection: () => this.startTranscodeInspectIfReady(),
        notify: (level, message) => this.notify(level, message)
      },
      this.fileChanges
    )
  }

  private get state(): State {
    return this.runtime.current
  }

  getState(): UploadFlowStateJSON {
    return this.runtime.getState()
  }

  private notify(level: NotifyPayload['level'], message: string): void {
    this.runtime.notify(level, message)
  }

  async flushPersist(): Promise<void> {
    await this.runtime.flushPersist()
  }

  /**
   * Write the snapshot now, whether or not one was pending.
   *
   * `flushPersist` only drains an existing debounce, so it writes nothing after
   * an `apply({ persist: false })`. Uploads apply that way for their progress
   * ticks, and a torrent that exists on the tracker has to reach disk before
   * the next one starts — otherwise a crash loses the record and the retry
   * uploads it twice.
   */
  private async persistNow(): Promise<void> {
    await this.runtime.persistNow()
  }

  private apply(next: State, options: { persist?: boolean } = {}): void {
    this.runtime.apply(next, options)
  }

  cancelAll(): void {
    this.tasks.invalidateAll()
    this.clearSpectralOptimizationState()
  }

  /** Guard for tasks that are only meaningful for the workspace they started on. */
  private stillOn(workspacePath: string): () => boolean {
    return () => this.state.draft.workspacePath === workspacePath
  }

  /** True only while the selected source has not changed since this work began. */
  private stillOnSource(generation: number, sourcePath: string): boolean {
    return generation === this.tasks.generation && this.state.draft.sourcePath === sourcePath
  }

  /** True only while the exact workspace has not changed since this work began. */
  private stillOnWorkspace(generation: number, workspacePath: string): boolean {
    return (
      generation === this.tasks.generation &&
      this.state.draft.workspacePath === workspacePath
    )
  }

  async setCurrentStep(index: number, confirmedWrites = false): Promise<{ ok: true } | { ok: false; error: string; needsConfirmation?: boolean }> {
    const navigation = evaluateStepNavigation(this.state, index)
    if (!navigation.ok) return navigation
    index = navigation.index
    const from = this.state.currentStep
    const transcodeIdx = stepIndex('transcode')
    const uploadIdx = stepIndex('upload')
    const seedIdx = stepIndex('seed')
    const tagsIdx = stepIndex('tags')
    const spectralsIdx = stepIndex('spectrals')
    if (tagsIdx !== null && from <= tagsIdx && index > tagsIdx) {
      const applied = await this.applyTagsAndNames(confirmedWrites)
      if (!applied.ok) return applied
      if (transcodeIdx !== null && index > transcodeIdx && this.state.transcode.phase === 'idle') {
        index = transcodeIdx
      }
    }
    this.apply(setCurrentStep(this.state, index))
    if (spectralsIdx !== null && from === spectralsIdx && index > spectralsIdx) {
      void this.startSelectedSpectralOptimization()
    }
    if (transcodeIdx !== null && from <= transcodeIdx && index > transcodeIdx) {
      void this.runTranscode({ quiet: true })
    }
    if (uploadIdx !== null && index === uploadIdx) {
      void this.ensureUploadReport()
    }
    if (seedIdx !== null && index === seedIdx && this.state.upload.phase === 'done') {
      if (this.state.seed.phase === 'idle') {
        void this.startSeed()
      }
    }
    return { ok: true }
  }

  async ensureUploadReport(): Promise<void> {
    // Building a report can read the workspace and await cover resolution. Do
    // not let a build that began before a user edit replace that edit once it
    // finishes.
    const state = this.state
    const next = await ensureUploadReport(state, this.deps.getConfig())
    if (state !== this.state) return
    if (next !== state) this.apply(next)
  }

  updateUploadReport(patch: Partial<UploadSnapshot>): void {
    this.apply(updateUploadReport(this.state, patch))
  }

  async searchTrackerGroups(options: { force?: boolean } = {}): Promise<void> {
    const cfg = this.deps.getConfig()
    const upload = this.state.upload
    const request = groupSearchRequest(upload, cfg)
    const { trackerIds, queryStrings, fingerprint } = request

    const current = upload.groupSearch
    if (
      !options.force &&
      current &&
      current.fingerprint === fingerprint &&
      (current.status === 'done' || current.status === 'running')
    ) {
      return
    }

    const running: TrackerGroupSearchSnapshot = {
      status: 'running',
      queryStrings,
      trackerIds,
      fingerprint,
      results: current?.fingerprint === fingerprint ? (current.results ?? []) : [],
      searchedAt: current?.searchedAt
    }
    this.apply(setGroupSearch(this.state, running), { persist: false })

    await this.groupSearch.run(
      async (task) => {
        const result = await searchTrackerGroups(cfg, request, task.signal)
        if (!task.fresh()) return
        this.apply(setGroupSearch(this.state, result))
      },
      {
        onError: (err) => {
          this.apply(
            setGroupSearch(this.state, {
              status: 'failed',
              queryStrings,
              trackerIds,
              fingerprint,
              results: running.results,
              error: String((err as Error).message ?? err),
              searchedAt: Date.now()
            })
          )
        }
      }
    )
  }

  async fetchTorrentGroup(
    trackerId: UploadTrackerId,
    groupId: number
  ): Promise<TrackerGroupDetail> {
    return fetchTorrentGroupDetail(this.deps.getConfig(), trackerId, groupId)
  }

  async resolveTorrentGroupId(
    trackerId: UploadTrackerId,
    torrentId: number
  ): Promise<number | null> {
    return resolveTorrentIdToGroupId(this.deps.getConfig(), trackerId, torrentId)
  }

  async submitUpload(): Promise<{ ok: true } | { ok: false; error: string }> {
    let cfg = this.deps.getConfig()
    const transcodeError = validateSelectedTranscodes(this.state.transcode)
    if (transcodeError) {
      this.apply(failUploadReport(this.state, transcodeError))
      this.notify('error', transcodeError)
      return { ok: false, error: transcodeError }
    }

    // Rebuild from the finished jobs at the last safe moment. This closes the
    // gap where the Upload screen opened before its background transcodes did.
    await this.ensureUploadReport()
    cfg = this.deps.getConfig()

    const pendingTrackerIds = pendingUploadTrackerIds(this.state.upload)

    const error =
      validatePreparedUploadFormats(this.state) ??
      validateUploadReport(this.state.upload) ??
      validateUploadTargets(this.state.upload, cfg, pendingTrackerIds)
    if (error) {
      this.apply(failUploadReport(this.state, error))
      this.notify('error', error)
      return { ok: false, error }
    }

    let outcome: { ok: true } | { ok: false; error: string } = {
      ok: false,
      error: 'Upload was cancelled.'
    }

    await this.submit.run(
      async (task) => {
        const trackerRows = await healthcheckTrackers(cfg, pendingTrackerIds)
        if (!task.fresh()) return
        const trackerHealthError = validateTrackerHealth(trackerRows, pendingTrackerIds)
        if (trackerHealthError) {
          this.apply(failUploadReport(this.state, trackerHealthError))
          this.notify('error', trackerHealthError)
          outcome = { ok: false, error: trackerHealthError }
          return
        }

        const workspacePath = this.state.draft.workspacePath

        const hostingError = await this.hostImagesForSubmit(cfg, task)
        if (!task.fresh()) return
        if (hostingError) {
          this.apply(failUploadReport(this.state, hostingError))
          this.notify('error', hostingError)
          outcome = { ok: false, error: hostingError }
          return
        }

        this.apply(beginSubmit(this.state, planSubmissions(this.state.upload)))
        await this.persistNow()

        await runSubmissions({
          cfg,
          upload: this.state.upload,
          submissions: this.state.upload.submissions ?? [],
          workspacePath,
          version: APP_VERSION,
          lossyMaster: this.state.draft.lossyMaster,
          lossyComment: this.state.draft.lossyComment,
          sourceUrl: this.state.metadata.selected?.url?.trim() ?? '',
          spectralBbcode: this.state.upload.spectralBbcode ?? '',
          signal: task.signal,
          fresh: () => task.fresh(),
          onPatch: (id, patch) => {
            if (!task.fresh()) return
            this.apply(patchSubmission(this.state, id, patch), { persist: false })
          },
          // A torrent that exists on the tracker must survive a crash on the
          // next format, or the retry would upload it a second time.
          onCommit: () => this.persistNow(),
          onSuccess: async (submission) => {
            if (!this.deps.recordUploadStatistic) return
            try {
              await this.deps.recordUploadStatistic({
                workspacePath,
                formatId: submission.formatId,
                trackerId: submission.trackerId
              })
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              this.notify('warning', `Could not update upload statistics: ${message}`)
            }
          },
          onGroupId: (trackerId, groupId) => {
            if (!task.fresh()) return
            this.apply(
              updateUploadReport(this.state, {
                groupIds: { ...(this.state.upload.groupIds ?? {}), [trackerId]: groupId }
              }),
              { persist: false }
            )
          }
        })
        if (!task.fresh()) return

        this.apply(finishSubmit(this.state))
        await this.persistNow()

        const succeeded = (this.state.upload.submissions ?? []).filter(
          (sub) => sub.status === 'done'
        )
        this.reportSubmitOutcome(succeeded.length)
        await this.cleanupAfterSubmit(cfg)

        if (succeeded.length === 0) {
          outcome = { ok: false, error: this.state.upload.error ?? 'No uploads succeeded.' }
          return
        }

        outcome = { ok: true }
        const seedIdx = stepIndex('seed')
        if (seedIdx !== null) this.apply(setCurrentStep(this.state, seedIdx))
        void this.startSeed()
      },
      {
        onError: (err) => {
          const message = err instanceof Error ? err.message : String(err)
          this.apply(failUploadReport(this.state, message))
          this.notify('error', `Upload failed: ${message}`)
          outcome = { ok: false, error: message }
        }
      }
    )

    return outcome
  }

  /** Cover and spectrals, hosted once before the first tracker call. */
  private async hostImagesForSubmit(cfg: Config, task: TaskHandle): Promise<string | null> {
    const hosted = await hostCoverImageForSubmit(this.state, cfg)
    if (!task.fresh()) return null
    if (hosted.error) this.notify('warning', hosted.error)
    if (hosted.image && hosted.image !== (this.state.upload.image ?? '').trim()) {
      this.apply({ ...this.state, upload: { ...this.state.upload, image: hosted.image } })
    }

    if ((this.state.upload.spectralBbcode ?? '') !== '') return null

    await this.waitForSelectedSpectralOptimization()
    if (!task.fresh()) return null

    const spectrals = await hostSpectralsForUpload(
      cfg,
      this.state.draft.workspacePath,
      this.state.draft.spectralIds,
      task.signal
    )
    if (!task.fresh()) return null
    if (spectrals.error) return spectrals.error

    this.apply(setSpectralBbcode(this.state, spectrals.bbcode))
    return null
  }

  private reportSubmitOutcome(succeeded: number): void {
    const submissions = this.state.upload.submissions ?? []
    if (succeeded === submissions.length && succeeded > 0) {
      this.notify('success', `Uploaded ${succeeded} torrent${succeeded === 1 ? '' : 's'}.`)
      return
    }
    if (succeeded > 0) {
      this.notify('warning', `${succeeded} of ${submissions.length} uploads succeeded.`)
      return
    }
    this.notify('error', this.state.upload.error ?? 'No uploads succeeded.')
  }

  private async cleanupAfterSubmit(cfg: Config): Promise<void> {
    if (!cfg.cleanup.deleteSpectralsAfterUpload) return
    // A retry needs the spectrals if hosting has to be redone, so only clear
    // them once nothing is left to send.
    if (this.state.upload.phase !== 'done') return
    try {
      await rm(join(uploadWorkspaceRootForPath(this.state.draft.workspacePath), 'Spectrals'), {
        recursive: true,
        force: true
      })
    } catch {
      // Disk hygiene; not worth failing a completed upload over.
    }
  }

  async startSeed(): Promise<void> {
    const cfg = this.deps.getConfig()
    const formats = seedFormatsFromUpload(this.state.upload)
    const seedingEnabled =
      cfg.transfer.enabled || cfg.directories.seeding.trim() !== '' || cfg.torrentClient.enabled
    if (!seedingEnabled) {
      this.apply(setSeed(this.state, { phase: 'done', tasks: [], error: undefined }))
      this.notify('info', 'Seedbox, seeding folder and torrent client are all off — nothing to seed.')
      return
    }

    const previousTasks = this.state.seed.tasks
    await this.seed.run(
      async (task) => {
        const result = await runSeed({
          cfg,
          formats,
          previousTasks,
          signal: task.signal,
          onProgress: (seed) => {
            if (!task.fresh()) return
            this.apply(setSeed(this.state, seed), { persist: false })
          }
        })
        if (!task.fresh()) return
        this.apply(setSeed(this.state, result))
        if (result.phase === 'failed') {
          this.notify('warning', result.error ?? 'Seeding finished with errors.')
        } else if (result.tasks.length > 0) {
          this.notify('success', 'Seeding finished.')
        }
      },
      {
        onError: (err) => {
          const message = err instanceof Error ? err.message : String(err)
          this.apply(setSeed(this.state, { ...this.state.seed, phase: 'failed', error: message }))
          this.notify('error', `Seeding failed: ${message}`)
        }
      }
    )
  }

  /** Records a completed release before dropping its working copy. */
  async finish(): Promise<{ ok: true } | { ok: false; error: string }> {
    const seed = this.state.seed
    if (seed.phase !== 'done') {
      return { ok: false, error: 'Finish seeding before completing this upload.' }
    }

    const upload = this.state.upload
    const record = {
      kind: 'uploaded' as const,
      name: basename(this.state.draft.sourcePath),
      sourcePath: this.state.draft.sourcePath,
      completedAt: Date.now(),
      sourceExists: true,
      artists: [
        ...new Set((upload.artists ?? []).filter(isNamedMainArtist).map((artist) => artist.name.trim()))
      ],
      title: upload.title,
      year: upload.year,
      submissions: (upload.submissions ?? [])
        .filter((submission) => submission.status === 'done')
        .map((submission) => ({
          trackerId: submission.trackerId,
          label: submission.label,
          url: submission.url,
          torrentId: submission.torrentId,
          groupId: submission.groupId
        }))
    }
    try {
      await this.persistNow()
      await saveUploadedRelease(this.deps.userDataPath, record)
    } catch (err) {
      const error = `Could not save upload history: ${String(err)}`
      this.notify('error', error)
      return { ok: false, error }
    }

    this.cancelAll()
    await this.cleanupAfterSeed(this.deps.getConfig(), seed)
    this.apply(newState())
    return { ok: true }
  }

  /**
   * Drops the working copy once the release is somewhere else.
   *
   * Guarded hard: the workspace holds the only copy of the transcodes, so this
   * runs only when every transfer or copy actually landed.
   */
  private async cleanupAfterSeed(cfg: Config, seed: SeedSnapshot): Promise<void> {
    if (!cfg.cleanup.deleteTemporaryFiles) return
    if (seed.phase !== 'done') return

    const placements = seed.tasks.filter((t) => t.kind === 'transfer' || t.kind === 'copy')
    if (placements.length === 0) return
    if (!placements.every((t) => t.status === 'done')) return

    const workspacePath = this.state.draft.workspacePath
    if (!workspacePath) return
    try {
      await removeUploadWorkspace(uploadWorkspaceRootForPath(workspacePath))
      this.notify(
        'info',
        'Working copy removed — the release now lives at its seeding location.'
      )
    } catch {
      // The release is seeding either way; a stale working copy is not worth
      // reporting as a seeding failure.
    }
  }

  async listStartEntries(): Promise<UploadStartEntries> {
    await this.persistNow()
    return listUploadStartEntries({
      userDataPath: this.deps.userDataPath,
      sourceDirectory: this.deps.getConfig().directories.source
    })
  }

  async startNew(path: string): Promise<void> {
    await this.persistNow()
    this.cancelAll()
    const generation = this.tasks.generation
    this.apply(setCurrentStep(selectSourcePath(newState(), path), FILES_CHECK_STEP))
    await this.copyFresh(path, generation)
  }

  async resume(workspacePath: string): Promise<void> {
    if (!uploadWorkspaceBelongsToUserData(this.deps.userDataPath, workspacePath)) {
      throw new Error('Upload workspace is outside Gravlax app data.')
    }
    await this.persistNow()
    this.cancelAll()
    const generation = this.tasks.generation
    const workspaceRootPath = uploadWorkspaceRootForPath(workspacePath)
    const sourcePath = await readUploadWorkspaceSource(workspaceRootPath)
    try {
      await access(workspacePath)
    } catch {
      this.notify('warning', 'The saved working copy was incomplete. Creating a fresh one from the source folder.')
      this.apply(setCurrentStep(selectSourcePath(newState(), sourcePath), FILES_CHECK_STEP))
      await this.copyFresh(sourcePath, generation)
      return
    }
    try {
      const snap = await readUploadFlow(workspaceRootPath)
      this.apply(restoreState(workspacePath, snap))
    } catch {
      this.notify('warning', 'Could not restore all saved upload progress. Continuing from Files Check.')
      this.apply(setWorkspacePath(selectSourcePath(newState(), sourcePath), workspacePath))
    }
    const stillOnWorkspace = (): boolean => this.stillOnWorkspace(generation, workspacePath)
    await this.ensureFilesInitialized(true, stillOnWorkspace)
    if (!stillOnWorkspace()) return
    await this.recoverInterruptedFileChanges(stillOnWorkspace)
    if (!stillOnWorkspace()) return
    await this.maybeAutoDetectSourceMedia(workspacePath, stillOnWorkspace)
    if (!stillOnWorkspace()) return
    this.scheduleReadyTasks()
  }

  private async copyFresh(
    sourcePath: string,
    generation: number
  ): Promise<void> {
    // The copy has no TaskSlot of its own — it is what defines a generation
    // rather than running inside one — so it checks the generation directly.
    let workspacePath: string
    try {
      workspacePath = await copyFolderToUploadWorkspace(this.deps.userDataPath, sourcePath)
    } catch (err) {
      // The old workspace is deliberately still here: a failed copy must not
      // leave the user with neither the new copy nor the one they had.
      if (!this.stillOnSource(generation, sourcePath)) return
      this.notify('error', `Could not copy source folder: ${String(err)}`)
      return
    }

    if (!this.stillOnSource(generation, sourcePath)) {
      await removeUploadWorkspace(uploadWorkspaceRootForPath(workspacePath))
      return
    }
    if (!this.stillOnSource(generation, sourcePath)) {
      await removeUploadWorkspace(uploadWorkspaceRootForPath(workspacePath))
      return
    }
    this.apply(setWorkspacePath(this.state, workspacePath))
    const stillOnWorkspace = (): boolean => this.stillOnWorkspace(generation, workspacePath)
    try {
      await this.maybeAutoDetectSourceMedia(workspacePath, stillOnWorkspace)
    } catch (err) {
      // Detection is a convenience; the user can still pick the media by hand.
      if (stillOnWorkspace()) {
        this.notify('warning', `Could not detect source media: ${String(err)}`)
      }
    }
    if (!stillOnWorkspace()) {
      return
    }
    this.scheduleReadyTasks()
  }

  // The answer comes from the folder itself — logs mean a CD rip — so the user
  // is only ever correcting a reading, never supplying one from nothing. This
  // is what lets files check start on its own for the ordinary WEB release.
  private async maybeAutoDetectSourceMedia(
    folderPath: string,
    stillCurrent: () => boolean = () => true
  ): Promise<void> {
    const detected = (await detectSourceMedia(folderPath)) ?? 'WEB'
    if (!stillCurrent() || this.state.draft.workspacePath !== folderPath) return
    if (this.state.draft.sourceMedia !== '') return
    this.apply(setSourceMedia(this.state, detected))
  }

  private async ensureFilesInitialized(
    grandfatherPastTags = false,
    stillCurrent: () => boolean = () => true
  ): Promise<void> {
    if (!this.state.draft.workspacePath || this.state.files.apply.files.length > 0) return
    const workspacePath = this.state.draft.workspacePath
    const files = await discoverFLACFiles(workspacePath)
    if (!stillCurrent() || this.state.draft.workspacePath !== workspacePath) return
    let next = initializeFiles(this.state, basename(workspacePath), files.map((file) => file.relativePath))
    const tagsIdx = stepIndex('tags') ?? 3
    if (grandfatherPastTags && next.currentStep > tagsIdx) {
      next = {
        ...next,
        files: { ...next.files, apply: { ...next.files.apply, grandfathered: true } }
      }
      const plan = buildFilesRenamePlan({
        release: next.tags.proposed ?? next.tags.current ?? {},
        files: next.files,
        naming: this.deps.getConfig().naming,
        sourceMedia: next.draft.sourceMedia,
        encoding: next.transcode.inspection?.encoding
      })
      next = {
        ...next,
        files: { ...next.files, apply: { ...next.files.apply, phase: 'applied', appliedHash: plan.hash } }
      }
    }
    if (stillCurrent() && this.state.draft.workspacePath === workspacePath) this.apply(next)
  }

  private async recoverInterruptedFileChanges(
    stillCurrent: () => boolean = () => true
  ): Promise<void> {
    const phase = this.state.files.apply.phase
    if (phase !== 'applying' && phase !== 'restoring') return
    const workspacePath = this.state.draft.workspacePath
    if (!workspacePath || !stillCurrent()) return
    const release = this.state.tags.proposed ?? this.state.tags.current ?? {}
    const plan = buildFilesRenamePlan({
      release,
      files: this.state.files,
      naming: this.deps.getConfig().naming,
      sourceMedia: this.state.draft.sourceMedia,
      encoding: this.state.transcode.inspection?.encoding
    })
    const reconciled = []
    for (const file of this.state.files.apply.files) {
      if (!stillCurrent() || this.state.draft.workspacePath !== workspacePath) return
      let currentPath = file.currentPath
      if (!(await pathExists(join(workspacePath, currentPath)))) {
        if (!stillCurrent() || this.state.draft.workspacePath !== workspacePath) return
        const target = phase === 'applying'
          ? plan.files.find((item) => item.id === file.id)?.targetPath
          : this.state.files.original.files.find((item) => item.id === file.id)?.relativePath
        if (target && await pathExists(join(workspacePath, target))) {
          if (!stillCurrent() || this.state.draft.workspacePath !== workspacePath) return
          currentPath = target
        }
      }
      reconciled.push({ ...file, currentPath })
    }
    if (!stillCurrent() || this.state.draft.workspacePath !== workspacePath) return
    this.apply({
      ...this.state,
      files: {
        ...this.state.files,
        apply: {
          ...this.state.files.apply,
          phase: phase === 'applying' ? 'idle' : phase,
          currentFolderName: basename(workspacePath),
          files: reconciled
        }
      }
    })
    const result = phase === 'applying'
      ? await this.applyTagsAndNames(true)
      : await this.revertFiles()
    if (!stillCurrent() || this.state.draft.workspacePath !== workspacePath) return
    if (!result.ok) this.notify('error', `Could not recover interrupted file changes: ${result.error}`)
  }

  selectSourceMedia(media: SourceMedia): void {
    if (media === this.state.draft.sourceMedia) return
    // Only files check reads the media type, so only files check is thrown away.
    this.filesCheck.cancel()
    this.apply(setSourceMedia(this.state, media))
    this.scheduleReadyTasks()
  }

  setLossyMaster(value: boolean): void {
    this.apply(setLossyMaster(this.state, value))
    // Lossy masters have their own default selection, so the pre-selection
    // follows the toggle — unless the user has already picked by hand.
    void this.deriveSpectralIdsFromDisk()
  }

  setLossyComment(value: string): void {
    this.apply(setLossyComment(this.state, value))
  }

  setSpectralIds(ids: number[]): void {
    this.apply(setSpectralIds(this.state, ids))
  }

  /**
   * Re-apply the settings pre-selection for the tracks that have spectrals.
   *
   * A no-op once the user has chosen for themselves — `setDefaultSpectralIds`
   * drops it — so this only ever moves an untouched selection.
   */
  private applyDefaultSpectralIds(trackCount: number): void {
    if (!this.state.draft.spectralIdsAuto) return
    const ids = spectralIdsForRelease(
      this.deps.getConfig().spectral,
      this.state.draft.lossyMaster,
      trackCount
    )
    this.apply(setDefaultSpectralIds(this.state, ids))
  }

  private async deriveSpectralIdsFromDisk(): Promise<void> {
    if (!this.state.draft.spectralIdsAuto) return
    const workspacePath = this.state.draft.workspacePath
    if (!workspacePath) return
    const pairs = await listSpectralPairs(workspacePath)
    if (this.state.draft.workspacePath !== workspacePath) return
    if (pairs.length === 0) return
    this.applyDefaultSpectralIds(pairs.length)
  }

  async resolveMetadataUrl(url: string): Promise<MetadataUrlResolution> {
    const { resolveMetadataUrl } = await import('@main/core/tools/metadata/search')
    return resolveMetadataUrl(this.deps.getConfig(), url)
  }

  selectMetadataMatch(selection: MetadataSelection | null): void {
    this.tags.cancel()
    if (!selection) {
      this.apply(clearTagsRelease(clearMetadataSelection(this.state)))
      return
    }
    this.apply(setMetadataSelection(clearTagsRelease(this.state), selection))
    void this.startTagsReleaseIfNeeded()
  }

  updateTagsProposed(release: Release): void {
    this.fileChangesService.updateTagsProposed(release)
  }

  setFilenameOverride(id: string, value?: string): void {
    this.fileChangesService.setFilenameOverride(id, value)
  }

  setFolderNameOverride(value?: string): void {
    this.fileChangesService.setFolderNameOverride(value)
  }

  setRenameReleaseFolder(value: boolean): void {
    this.fileChangesService.setRenameReleaseFolder(value)
  }

  setStripEmbeddedCoverArt(value: boolean): void {
    this.fileChangesService.setStripEmbeddedCoverArt(value)
  }

  async applyTagsAndNames(confirmedWrites = false): Promise<{ ok: true } | { ok: false; error: string; needsConfirmation?: boolean }> {
    return this.fileChangesService.applyTagsAndNames(confirmedWrites)
  }

  async revertFiles(): Promise<{ ok: true } | { ok: false; error: string }> {
    return this.fileChangesService.revertFiles()
  }

  setTagsCursor(cursor: number): void {
    this.apply(setTagsCursor(this.state, cursor))
  }

  async regenerateSpectrals(): Promise<void> {
    this.spectralOptimization.cancel()
    this.clearSpectralOptimizationState()
    this.apply(resetBackgroundTask(this.state, 'spectrals'))
    this.startSpectralsIfReady()
  }

  async refreshFilesCheck(): Promise<void> {
    this.filesCheck.cancel()
    this.apply(resetBackgroundTask(clearFilesCheck(this.state), 'files-check'))
    this.startFilesCheckIfReady()
  }

  async refreshMetadata(): Promise<void> {
    this.apply(resetBackgroundTask(this.state, 'metadata'))
    this.startMetadataIfReady()
  }

  async refreshTags(): Promise<void> {
    if (!this.state.draft.workspacePath) return
    const workspacePath = this.state.draft.workspacePath
    // A failed metadata request leaves the proposed release empty. Reloading
    // tags must retry that request too, rather than only rereading the files.
    this.tags.cancel()
    this.apply(clearTagsRelease(this.state))
    this.apply(setTagsCurrentLoading(this.state))
    if (!(await this.loadCurrentTags(workspacePath))) return
    if (this.state.tags.currentStatus !== 'ready') return
    if (!this.state.metadata.selected) return
    void this.startTagsReleaseIfNeeded()
  }

  setTranscodeSelection(optionIds: string[]): void {
    this.apply(setTranscodeSelection(this.state, optionIds))
  }

  setTranscodeEssentialOnly(essentialOnly: boolean): void {
    this.apply(setTranscodeEssentialOnly(this.state, essentialOnly))
  }

  async refreshTranscode(): Promise<void> {
    this.transcode.cancel()
    this.apply(resetBackgroundTask(setTranscodePhase(this.state, 'idle'), 'transcode'))
    this.startTranscodeInspectIfReady()
  }

  async runTranscode(opts?: { quiet?: boolean }): Promise<void> {
    const quiet = opts?.quiet === true
    if (!this.state.draft.workspacePath) return
    if (this.state.transcode.phase === 'running' || this.state.transcode.phase === 'inspecting') return

    const inspection = this.state.transcode.inspection
    if (!inspection) {
      if (!quiet) this.notify('warning', 'Transcode inspection is not ready yet.')
      return
    }
    if (inspection.blockers.some((b) => b.kind === 'lossy' || b.kind === 'empty')) {
      if (!quiet) {
        this.notify('error', inspection.blockers[0]?.message ?? 'Cannot transcode this release.')
      }
      return
    }

    const selectedIds = this.state.transcode.selectedOptionIds ?? []
    const selected = inspection.options.filter((o) => selectedIds.includes(o.id))
    if (selected.length === 0) {
      if (!quiet) this.notify('info', 'No formats selected.')
      return
    }
    if (quiet && this.selectedTranscodesAlreadyPrepared()) return

    const workspacePath = this.state.draft.workspacePath
    const essentialOnly = this.state.transcode.essentialOnly ?? true

    const jobs: TranscodeJobResult[] = selected.map((option) => ({
      optionId: option.id,
      status: 'queued'
    }))
    this.apply(
      markBackgroundTaskRunning(
        setTranscodeJobs(setTranscodePhase(this.state, 'running'), jobs)
      , 'transcode')
    )

    await this.transcode.run(
      async (task) => {
        let completedJobs = 0
        for (const option of selected) {
          if (!task.fresh()) return
          task.signal.throwIfAborted()

          this.apply(
            updateTranscodeJob(this.state, { optionId: option.id, status: 'running' })
          )

          try {
            const onProgress = (progress: {
              completed: number
              total: number
              currentLabel: string
            }): void => {
              if (!task.fresh()) return
              const overallCurrent = completedJobs * 1000 + progress.completed
              const overallTotal = selected.length * Math.max(progress.total, 1)
              this.apply(
                markBackgroundTaskProgress(
                  this.state,
                  'transcode',
                  overallCurrent,
                  overallTotal,
                  `${option.name}: ${progress.currentLabel || 'working'}`
                )
              )
            }

            let outputPath: string

            if (option.action === 'transcode') {
              if (!option.bitrate) throw new Error(`missing bitrate for ${option.id}`)
              const result = await transcodeFolder(workspacePath, option.bitrate, {
                essentialOnly,
                signal: task.signal,
                tools: this.deps.tools,
                onProgress
              })
              outputPath = result.outputPath
            } else {
              if (!option.targetBitDepth || !option.targetSampleRate) {
                throw new Error(`missing downconvert targets for ${option.id}`)
              }
              const result = await convertFolder(workspacePath, {
                bitDepth: option.targetBitDepth,
                sampleRate: option.targetSampleRate,
                essentialOnly,
                signal: task.signal,
                tools: this.deps.tools,
                onProgress
              })
              outputPath = result.outputPath
            }

            completedJobs++
            this.apply(
              updateTranscodeJob(this.state, {
                optionId: option.id,
                status: 'succeeded',
                outputPath
              })
            )
          } catch (err) {
            if (isAbortError(err)) return
            completedJobs++
            // Mark this format failed before rethrowing, so the job list shows
            // which one broke rather than just the overall failure.
            this.apply(
              updateTranscodeJob(this.state, {
                optionId: option.id,
                status: 'failed',
                error: String(err)
              })
            )
            throw err
          }
        }

        if (!task.fresh()) return
        const detail =
          selected.length === 1
            ? `Prepared ${selected[0]!.name}.`
            : `Prepared ${selected.length} formats.`
        this.apply(
          markBackgroundTaskCompleted(setTranscodePhase(this.state, 'done'), 'transcode', detail)
        )
        const uploadIdx = stepIndex('upload')
        if (uploadIdx !== null && this.state.currentStep === uploadIdx) {
          void this.ensureUploadReport()
        }
      },
      {
        guard: this.stillOn(workspacePath),
        onError: (err) => {
          this.apply(
            markBackgroundTaskFailed(
              setTranscodePhase(this.state, 'failed', String(err)),
              'transcode',
              String(err)
            )
          )
          this.notify('error', `Transcode failed: ${String(err)}`)
        }
      }
    )
  }

  private selectedTranscodesAlreadyPrepared(): boolean {
    const selectedIds = this.state.transcode.selectedOptionIds ?? []
    if (selectedIds.length === 0) return true
    const jobs = this.state.transcode.jobs ?? []
    return selectedIds.every((id) => {
      const job = jobs.find((j) => j.optionId === id)
      return job?.status === 'succeeded'
    })
  }

  async listSpectrals(): Promise<Array<{ full: string; zoom: string; index: number; filename: string }>> {
    const workspacePath = this.state.draft.workspacePath
    if (!workspacePath) return []
    const pairs = await listSpectralPairs(workspacePath)
    // A resumed session comes back with spectrals already on disk and no
    // selection behind them, so seed one the first time the view asks.
    if (
      pairs.length > 0 &&
      this.state.draft.spectralIds.length === 0 &&
      this.state.draft.workspacePath === workspacePath
    ) {
      this.applyDefaultSpectralIds(pairs.length)
    }
    return pairs
  }

  async cacheSize(): Promise<number> {
    return workspaceSize(this.deps.userDataPath)
  }

  async clearCache(): Promise<void> {
    this.cancelAll()
    await clearWorkspace(this.deps.userDataPath)
    this.apply(newState())
    this.notify('success', 'Workspace cleared.')
  }

  private scheduleReadyTasks(): void {
    this.startSpectralsIfReady()
    this.startFilesCheckIfReady()
    this.startMetadataIfReady()
    this.startTranscodeInspectIfReady()
    void this.startTagsCurrentIfReady()
    void this.startTagsReleaseIfNeeded()
  }

  private startTranscodeInspectIfReady(): void {
    if (!this.state.draft.workspacePath) return
    const t = getTask(this.state.background, 'transcode')
    if (!t || t.status !== 'queued') return

    const workspacePath = this.state.draft.workspacePath
    this.apply(
      markBackgroundTaskRunning(setTranscodePhase(this.state, 'inspecting'), 'transcode')
    )

    void this.transcode.run(
      async (task) => {
        const inspection = await inspectTranscode(workspacePath)
        if (!task.fresh()) return
        const detail =
          inspection.blockers.length > 0
            ? inspection.blockers[0]!.message
            : inspection.options.length === 0
              ? 'No transcode options available.'
              : `Found ${inspection.options.length} format option${inspection.options.length === 1 ? '' : 's'}.`
        const statusFailed = inspection.blockers.some(
          (b) => b.kind === 'lossy' || b.kind === 'empty'
        )
        this.apply(
          statusFailed
            ? markBackgroundTaskFailed(
                setTranscodeInspection(this.state, inspection),
                'transcode',
                detail
              )
            : markBackgroundTaskCompleted(
                setTranscodeInspection(this.state, inspection),
                'transcode',
                detail
              )
        )
      },
      {
        guard: this.stillOn(workspacePath),
        onError: (err) => {
          this.apply(
            markBackgroundTaskFailed(
              setTranscodePhase(this.state, 'failed', String(err)),
              'transcode',
              String(err)
            )
          )
        }
      }
    )
  }

  private startSpectralsIfReady(): void {
    if (!this.state.draft.workspacePath) return
    const t = getTask(this.state.background, 'spectrals')
    if (!t || t.status !== 'queued') return

    const workspacePath = this.state.draft.workspacePath
    this.spectralOptimization.cancel()
    this.clearSpectralOptimizationState()
    this.apply(markBackgroundTaskRunning(this.state, 'spectrals'))

    void this.spectrals.run(
      async (task) => {
        const summary = await generateSpectrals(workspacePath, {
          signal: task.signal,
          tools: this.deps.tools,
          onProgress: (progress) => {
            if (!task.fresh()) return
            this.apply(
              markBackgroundTaskProgress(
                this.state,
                'spectrals',
                progress.completedTracks,
                progress.totalTracks,
                progress.currentTrack
              )
            )
          }
        })
        if (!task.fresh()) return
        const spectralDetail =
          summary.trackCount === 1
            ? 'Generated spectrals for 1 track.'
            : summary.trackCount === 0
              ? 'No FLAC files found.'
              : `Generated spectrals for ${summary.trackCount} tracks.`

        this.apply(markBackgroundTaskCompleted(this.state, 'spectrals', spectralDetail))
        this.applyDefaultSpectralIds(summary.trackCount)
      },
      {
        guard: this.stillOn(workspacePath),
        onError: (err) => {
          this.apply(markBackgroundTaskFailed(this.state, 'spectrals', String(err)))
        }
      }
    )
  }

  private startSelectedSpectralOptimization(): Promise<void> {
    const key = this.currentSpectralOptimizationKey()
    if (key === this.spectralOptimizationKey) return this.spectralOptimizationPromise

    const workspacePath = this.state.draft.workspacePath
    const selectedIds = [...this.state.draft.spectralIds]
    const enabled = this.deps.getConfig().spectral.compress
    this.spectralOptimizationKey = key

    if (!workspacePath || !enabled || selectedIds.length === 0) {
      this.spectralOptimization.cancel()
      this.spectralOptimizationPromise = Promise.resolve()
      return this.spectralOptimizationPromise
    }

    const selected = new Set(selectedIds)
    const optimize = this.deps.optimizeSpectralPngs ?? compressSpectralPngs
    const promise = this.spectralOptimization.run(
      async (task) => {
        const pairs = await listSpectralPairs(workspacePath)
        if (!task.fresh()) return
        const paths = pairs
          .filter((pair) => selected.has(pair.index))
          .flatMap((pair) => [pair.full, pair.zoom])
          .filter((path) => !this.checkedSpectralPaths.has(path))
        if (paths.length === 0) return

        const result = await optimize(paths, { signal: task.signal })
        if (!task.fresh()) return
        this.recordSpectralOptimization(result)
      },
      {
        guard: this.stillOn(workspacePath),
        onError: (err) => {
          this.notify('warning', `Could not optimize spectral images; using originals: ${String(err)}`)
        }
      }
    )
    this.spectralOptimizationPromise = promise
    return promise
  }

  private async waitForSelectedSpectralOptimization(): Promise<void> {
    for (;;) {
      const key = this.currentSpectralOptimizationKey()
      const pending = key === this.spectralOptimizationKey
        ? this.spectralOptimizationPromise
        : this.startSelectedSpectralOptimization()
      await pending
      if (key === this.currentSpectralOptimizationKey()) return
    }
  }

  private recordSpectralOptimization(result: SpectralCompressionResult): void {
    for (const path of result.checkedPaths) this.checkedSpectralPaths.add(path)
    if (result.failures.length === 0) return
    const count = result.failures.length
    this.notify(
      'warning',
      `Could not optimize ${count} spectral image${count === 1 ? '' : 's'}; using originals.`
    )
  }

  private currentSpectralOptimizationKey(): string {
    const config = this.deps.getConfig()
    return [
      this.state.draft.workspacePath,
      config.spectral.compress ? 'on' : 'off',
      ...this.state.draft.spectralIds
    ].join('\u0000')
  }

  private clearSpectralOptimizationState(): void {
    this.spectralOptimizationPromise = Promise.resolve()
    this.spectralOptimizationKey = ''
    this.checkedSpectralPaths.clear()
  }

  private startFilesCheckIfReady(): void {
    if (!this.state.draft.workspacePath || !this.state.draft.sourceMedia) return
    const t = getTask(this.state.background, 'files-check')
    if (!t || t.status !== 'queued') return

    const workspacePath = this.state.draft.workspacePath
    const sourceMedia = this.state.draft.sourceMedia
    this.apply(markBackgroundTaskRunning(setFilesCheckRunning(this.state), 'files-check'))

    void this.filesCheck.run(
      async (task) => {
        const mqaSummary = await checkMQAWorkspace(workspacePath, {
          signal: task.signal,
          tools: this.deps.tools,
          onProgress: (current, total, label) => {
            if (!task.fresh()) return
            this.apply(
              markBackgroundTaskProgress(this.state, 'files-check', current, total, label),
              { persist: false }
            )
          }
        })
        if (!task.fresh()) return

        // Logchecker is a tracker round-trip, and only CD rips have logs.
        const logSummary =
          sourceMedia === 'CD'
            ? await checkLogsWorkspace(workspacePath, {
                sourceMedia,
                trackers: createEnabledTrackers(this.deps.getConfig()),
                signal: task.signal
              })
            : { logFiles: [], checks: [] }
        if (!task.fresh()) return

        // A tracker that could not be reached fails the step; a rip with a
        // poor score does not — that is a finding, and the step reports it.
        const failed = logSummary.checks.some((c) => c.error)
        const next = setFilesCheck(this.state, {
          status: failed ? 'failed' : 'ok',
          mqa: mqaSummary,
          logs: logSummary
        })

        // task.detail stays human-readable for the expandable log view; the
        // renderer reads state.filesCheck for everything it shows.
        const parts = [mqaSummaryDetail(mqaSummary), logcheckerSummaryDetail(logSummary)]
        const detail = parts.filter(Boolean).join('\n\n')
        this.apply(
          failed
            ? markBackgroundTaskFailed(next, 'files-check', detail)
            : markBackgroundTaskCompleted(next, 'files-check', detail)
        )
      },
      {
        guard: this.stillOn(workspacePath),
        onError: (err) => {
          const next = setFilesCheck(this.state, {
            ...this.state.filesCheck,
            status: 'failed',
            error: String(err)
          })
          this.apply(markBackgroundTaskFailed(next, 'files-check', String(err)))
        }
      }
    )
  }

  private startMetadataIfReady(): void {
    if (!this.state.draft.workspacePath) return
    const t = getTask(this.state.background, 'metadata')
    if (!t || t.status !== 'queued') return

    const workspacePath = this.state.draft.workspacePath
    this.apply(markBackgroundTaskRunning(this.state, 'metadata'))

    void this.metadata.run((task) => this.runMetadata(task, workspacePath), {
      onError: (err) => {
        this.apply(markBackgroundTaskFailed(this.state, 'metadata', String(err)))
      }
    })
  }

  private async runMetadata(task: TaskHandle, workspacePath: string): Promise<void> {
    const { extractSearchBaseline } = await import('@main/core/tools/metadata/baseline')
    const { runMetaSearch, providerPlaceholders } = await import('@main/core/tools/metadata/search')
    const baseline = await extractSearchBaseline(workspacePath)
    if (!task.fresh()) return
    const placeholders = providerPlaceholders(this.deps.getConfig())
    this.apply(setMetadataProviders(setMetadataBaseline(this.state, baseline), placeholders))
    const providers = await runMetaSearch(
      this.deps.getConfig(),
      baseline,
      (progress) => {
        if (!task.fresh()) return
        this.apply(setMetadataProviders(this.state, progress))
      },
      task.signal
    )
    if (!task.fresh()) return
    this.apply(
      markBackgroundTaskCompleted(
        setMetadataProviders(this.state, providers),
        'metadata',
        summarizeMetadataSearch(providers)
      )
    )
  }

  private async startTagsCurrentIfReady(): Promise<void> {
    if (!this.state.draft.workspacePath) return
    const status = this.state.tags.currentStatus
    if (status === 'loading') return
    if (
      status === 'ready' &&
      this.state.files.original.embeddedCoverArtCount !== undefined
    ) return
    const workspacePath = this.state.draft.workspacePath
    this.apply(setTagsCurrentLoading(this.state))
    await this.loadCurrentTags(workspacePath)
  }

  /** Reads the tags already on disk. Resolves true if the run stayed current. */
  private async loadCurrentTags(workspacePath: string): Promise<boolean> {
    let loaded = false
    await this.tagsCurrent.run(
      async (task) => {
        const { release, embeddedCoverArtCount } =
          await extractAlbumReleaseWithEmbeddedCoverArt(workspacePath)
        if (!task.fresh()) return
        const files = await discoverFLACFiles(workspacePath)
        if (!task.fresh()) return
        this.apply(setEmbeddedCoverArtCount(
          initializeFiles(
            setTagsCurrent(this.state, release),
            basename(workspacePath),
            files.map((file) => file.relativePath)
          ),
          embeddedCoverArtCount
        ))
        if (this.state.metadata.selected?.provider === METADATA_PROVIDER_MANUAL) {
          this.apply(setTagsReleaseManual(this.state))
        }
        loaded = true
      },
      {
        guard: this.stillOn(workspacePath),
        onError: (err) => {
          this.apply(setTagsCurrentFailed(this.state, String(err)))
        }
      }
    )
    return loaded
  }

  private async startTagsReleaseIfNeeded(): Promise<void> {
    if (!this.state.draft.workspacePath) return
    const selection = this.state.metadata.selected
    if (!selection) return
    const status = this.state.tags.releaseStatus
    if (status === 'ready' || status === 'loading') return

    if (selection.provider === METADATA_PROVIDER_MANUAL) {
      if (this.state.tags.currentStatus === 'ready') {
        this.apply(setTagsReleaseManual(this.state))
      } else {
        this.apply(setTagsReleaseLoading(this.state))
      }
      return
    }

    const workspacePath = this.state.draft.workspacePath
    this.apply(setTagsReleaseLoading(this.state))

    await this.tags.run(
      async (task) => {
        const { fetchNormalizedRelease } = await import('@main/core/tools/metadata/release')
        const release = await fetchNormalizedRelease(
          this.deps.getConfig(),
          selection.provider ?? '',
          selection.releaseId ?? '',
          selection.url ?? '',
          task.signal
        )
        if (!task.fresh()) return
        this.apply(setTagsRelease(this.state, release))
      },
      {
        guard: this.stillOn(workspacePath),
        onError: (err) => {
          this.apply(setTagsReleaseFailed(this.state, String(err)))
        }
      }
    )
  }
}

function summarizeMetadataSearch(
  providers: Array<{ status?: string; results?: unknown[] }>
): string {
  let matchedProviders = 0
  let candidates = 0
  for (const provider of providers) {
    if (provider.status !== 'matched') continue
    matchedProviders++
    candidates += provider.results?.length ?? 0
  }
  if (candidates === 0) return 'No metadata matches found.'
  if (candidates === 1) return 'Found 1 metadata match.'
  if (matchedProviders <= 1) return `Found ${candidates} metadata matches.`
  return `Found ${candidates} metadata matches across ${matchedProviders} providers.`
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}
