import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import {
  markBackgroundTaskRunning,
  newBackgroundWork,
  newState,
  stepIndex,
  type State
} from '@main/core/uploadflow'
import { UploadSession } from '@main/services/uploadSession'
import { automaticToolResolver } from '@main/core/tools/binaries'
import { validatePreparedUploadFormats } from '@shared/upload/validation'

type SessionRuntime = {
  current: State
  apply: (next: State) => void
}

function newSession(): UploadSession {
  return new UploadSession({
    appVersion: '9.8.7',
    userDataPath: '',
    getConfig: defaultConfig,
    trashItem: async () => undefined,
    tools: automaticToolResolver,
    send: () => undefined
  })
}

function runtimeOf(session: UploadSession): SessionRuntime {
  return (session as unknown as { runtime: SessionRuntime }).runtime
}

function integrityReadyState(): State {
  const state = newState()
  state.filesCheck.integrity = {
    status: 'passed',
    checkedCount: 1,
    failures: [],
    repairedPaths: [],
    repairErrors: []
  }
  return state
}

function completedAlternateFormats(): State['transcode'] {
  return {
    phase: 'done',
    inspection: {
      encoding: '24bit Lossless',
      sampleRate: 48000,
      trackCount: 1,
      hybrid: false,
      blockers: [],
      options: [
        {
          id: 'downconvert-16-48000',
          name: '16bit 48.0 kHz',
          action: 'downconvert',
          targetBitDepth: 16,
          targetSampleRate: 48000,
          outputFolderName: 'Album [FLAC]'
        },
        {
          id: 'transcode-V0',
          name: 'MP3 V0',
          action: 'transcode',
          bitrate: 'V0',
          outputFolderName: 'Album [MP3 V0]'
        }
      ]
    },
    selectedOptionIds: ['downconvert-16-48000', 'transcode-V0'],
    essentialOnly: true,
    jobs: [
      {
        optionId: 'downconvert-16-48000',
        status: 'succeeded',
        outputPath: '/workspace/Album [FLAC]'
      },
      {
        optionId: 'transcode-V0',
        status: 'succeeded',
        outputPath: '/workspace/Album [MP3 V0]'
      }
    ]
  }
}

describe('UploadSession', () => {
  it('starts read-only preflight work before FLAC integrity passes', () => {
    const session = newSession()
    const internal = session as unknown as {
      scheduleReadyTasks: () => void
      startFilesCheckIfReady: () => void
      startSpectralsIfReady: () => void
      startMetadataIfReady: () => void
      startTranscodeInspectIfReady: () => void
      startTagsCurrentIfReady: () => Promise<void>
      startTagsReleaseIfNeeded: () => Promise<void>
    }
    const files = vi.spyOn(internal, 'startFilesCheckIfReady').mockImplementation(() => undefined)
    const spectrals = vi.spyOn(internal, 'startSpectralsIfReady').mockImplementation(() => undefined)
    const metadata = vi.spyOn(internal, 'startMetadataIfReady').mockImplementation(() => undefined)
    const transcode = vi.spyOn(internal, 'startTranscodeInspectIfReady').mockImplementation(() => undefined)
    const tagsCurrent = vi.spyOn(internal, 'startTagsCurrentIfReady').mockResolvedValue()
    const tagsRelease = vi.spyOn(internal, 'startTagsReleaseIfNeeded').mockResolvedValue()

    internal.scheduleReadyTasks()
    expect(files).toHaveBeenCalledOnce()
    expect(spectrals).toHaveBeenCalledOnce()
    expect(metadata).toHaveBeenCalledOnce()
    expect(transcode).toHaveBeenCalledOnce()
    expect(tagsCurrent).toHaveBeenCalledOnce()
    expect(tagsRelease).toHaveBeenCalledOnce()
  })

  it('refuses to encode before FLAC integrity passes', async () => {
    const send = vi.fn()
    const session = new UploadSession({
      appVersion: 'test',
      userDataPath: '',
      getConfig: defaultConfig,
      trashItem: async () => undefined,
      tools: automaticToolResolver,
      send
    })

    await session.runTranscode()

    expect(send).toHaveBeenCalledWith('upload:notify', {
      level: 'warning',
      message: 'Wait for FLAC integrity checks before transcoding.'
    })
  })

  it('queues spectrals again after waiting for a repair stop', async () => {
    const session = newSession()
    const runtime = runtimeOf(session)
    const state = markBackgroundTaskRunning({
      ...runtime.current,
      background: newBackgroundWork('/source'),
      metadata: { selected: { provider: 'manual' } },
      tags: { proposed: { title: 'Edited title' }, proposedDirty: true },
      transcode: completedAlternateFormats()
    }, 'spectrals')
    runtime.apply(state)
    const metadata = structuredClone(state.metadata)
    const tags = structuredClone(state.tags)
    const transcode = structuredClone(state.transcode)

    let finishStop!: () => void
    const stopped = new Promise<void>((resolve) => { finishStop = resolve })
    const cancelAndWait = vi.fn(() => stopped)
    const internal = session as unknown as {
      spectrals: { cancelAndWait: () => Promise<void> }
      stopSpectralsForRepair: (task: { signal: AbortSignal; fresh: () => boolean }) => Promise<void>
    }
    internal.spectrals = { cancelAndWait }
    const controller = new AbortController()
    const stopping = internal.stopSpectralsForRepair({
      signal: controller.signal,
      fresh: () => !controller.signal.aborted
    })

    expect(cancelAndWait).toHaveBeenCalledOnce()
    expect(runtime.current.background.tasks.find((task) => task.id === 'spectrals')?.status)
      .toBe('running')
    finishStop()
    await stopping

    expect(runtime.current.background.tasks.find((task) => task.id === 'spectrals')?.status)
      .toBe('queued')
    expect(runtime.current.metadata).toEqual(metadata)
    expect(runtime.current.tags).toEqual(tags)
    expect(runtime.current.transcode).toEqual(transcode)
  })

  it('refuses integrity repair after an upload has completed', async () => {
    const send = vi.fn()
    const session = new UploadSession({
      appVersion: 'test',
      userDataPath: '',
      getConfig: defaultConfig,
      trashItem: async () => undefined,
      tools: automaticToolResolver,
      send
    })
    const runtime = runtimeOf(session)
    runtime.apply({
      ...runtime.current,
      upload: { ...runtime.current.upload, phase: 'done' }
    })

    await session.repairFlacIntegrity()

    expect(send).toHaveBeenCalledWith('upload:notify', {
      level: 'error',
      message: 'FLACs cannot be repaired after upload or seeding has started.'
    })
  })

  it('refuses tracker submission until FLAC integrity passes', async () => {
    const session = newSession()
    const state = newState()
    state.upload.phase = 'ready'
    runtimeOf(session).apply(state)

    await expect(session.submitUpload()).resolves.toEqual({
      ok: false,
      error: 'Repair failed FLAC integrity checks before uploading.'
    })
    expect(session.getState().upload.phase).toBe('failed')
  })

  it('commits the report while keeping a description edit made during the build', async () => {
    const session = newSession()
    const state = integrityReadyState()
    state.currentStep = stepIndex('upload') ?? 6
    state.tags.proposed = { title: 'Album' }

    const runtime = runtimeOf(session)
    runtime.apply(state)

    const building = session.ensureUploadReport()
    session.updateUploadReport({ albumDesc: 'My edited description' })
    await building
    await session.flushPersist()

    expect(session.getState().upload.albumDesc).toBe('My edited description')
    expect(session.getState().upload.formats?.map((format) => format.id)).toEqual(['source'])
    expect(session.getState().upload.seededFrom).toBeTruthy()
  })

  it('uses the running app version in the upload report', async () => {
    const session = newSession()
    const state = integrityReadyState()
    state.currentStep = stepIndex('upload') ?? 6
    state.tags.proposed = { title: 'Album' }

    const runtime = runtimeOf(session)
    runtime.apply(state)

    await session.ensureUploadReport()

    expect(session.getState().upload.formats?.[0]?.releaseDesc).toContain(
      '[hr]Uploaded with [b]gravlax[/b] v9.8.7'
    )
  })

  it('keeps completed FLAC and MP3 formats when group search changes during the build', async () => {
    const session = newSession()
    const runtime = runtimeOf(session)
    const state = integrityReadyState()
    state.currentStep = stepIndex('upload') ?? 6
    state.tags.proposed = { title: 'Album' }
    state.transcode = completedAlternateFormats()
    runtime.apply(state)

    const building = session.ensureUploadReport()
    runtime.apply({
      ...runtime.current,
      upload: {
        ...runtime.current.upload,
        groupSearch: {
          status: 'done',
          queryStrings: ['Album'],
          trackerIds: [],
          fingerprint: 'search-result',
          results: []
        }
      }
    })
    await building

    const result = session.getState()
    expect(result.upload.formats?.map((format) => format.id)).toEqual([
      'source',
      'downconvert-16-48000',
      'transcode-V0'
    ])
    expect(result.upload.groupSearch?.fingerprint).toBe('search-result')
    expect(validatePreparedUploadFormats(result)).toBeNull()
  })

  it('keeps format edits while adding formats completed during the build', async () => {
    const session = newSession()
    const runtime = runtimeOf(session)
    const state = integrityReadyState()
    state.currentStep = stepIndex('upload') ?? 6
    state.tags.proposed = { title: 'Album' }
    runtime.apply(state)
    await session.ensureUploadReport()

    runtime.apply({ ...runtime.current, transcode: completedAlternateFormats() })
    const building = session.ensureUploadReport()
    session.updateUploadReport({
      formats: (runtime.current.upload.formats ?? []).map((format) => ({
        ...format,
        releaseDesc: 'My source description'
      }))
    })
    await building

    const formats = session.getState().upload.formats ?? []
    expect(formats.map((format) => format.id)).toEqual([
      'source',
      'downconvert-16-48000',
      'transcode-V0'
    ])
    expect(formats[0]?.releaseDesc).toBe('My source description')
    expect(session.getState().upload.seededFrom).toBeTruthy()
  })

  it('rebuilds with the latest inputs when they change during the build', async () => {
    const session = newSession()
    const runtime = runtimeOf(session)
    const state = integrityReadyState()
    state.currentStep = stepIndex('upload') ?? 6
    state.tags.proposed = { title: 'Old title' }
    runtime.apply(state)

    const building = session.ensureUploadReport()
    runtime.apply({
      ...runtime.current,
      tags: {
        ...runtime.current.tags,
        proposed: { ...runtime.current.tags.proposed, title: 'New title' }
      }
    })
    await building

    expect(session.getState().upload.title).toBe('New title')
    expect(session.getState().upload.seededFrom).toBeTruthy()
  })

  it('does not replace a payload that starts submitting during the build', async () => {
    const session = newSession()
    const runtime = runtimeOf(session)
    const state = integrityReadyState()
    state.currentStep = stepIndex('upload') ?? 6
    state.tags.proposed = { title: 'Album' }
    runtime.apply(state)

    const building = session.ensureUploadReport()
    runtime.apply({
      ...runtime.current,
      upload: {
        ...runtime.current.upload,
        phase: 'submitting',
        formats: [
          {
            id: 'fixed',
            label: 'Fixed payload',
            folderPath: '/workspace/fixed',
            format: 'FLAC',
            bitrate: 'Lossless',
            otherBitrate: '',
            vbr: false,
            releaseDesc: 'Do not replace',
            logfileNames: []
          }
        ]
      }
    })
    await building

    expect(session.getState().upload.phase).toBe('submitting')
    expect(session.getState().upload.formats?.map((format) => format.id)).toEqual(['fixed'])
  })

  it('does not commit a report after the workspace changes', async () => {
    const session = newSession()
    const runtime = runtimeOf(session)
    const state = integrityReadyState()
    state.currentStep = stepIndex('upload') ?? 6
    state.tags.proposed = { title: 'Old workspace' }
    runtime.apply(state)

    const building = session.ensureUploadReport()
    runtime.apply({
      ...runtime.current,
      draft: { ...runtime.current.draft, workspacePath: '/workspace/new' },
      tags: { ...runtime.current.tags, proposed: { title: 'New workspace' } }
    })
    await building

    expect(session.getState().upload.formats).toEqual([])
    expect(session.getState().upload.seededFrom).toBe('')
  })
})
