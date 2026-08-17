import { describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import { newState, stepIndex, type State } from '@main/core/uploadflow'
import { UploadSession } from '@main/services/uploadSession'
import { automaticToolResolver } from '@main/core/tools/binaries'

const mocks = vi.hoisted(() => ({ healthcheckTrackers: vi.fn() }))

vi.mock('@main/core/tools/trackers/health', () => ({
  healthcheckTrackers: mocks.healthcheckTrackers
}))

function validState(): State {
  const state = newState()
  state.currentStep = stepIndex('upload') ?? 6
  state.draft.workspacePath = '/workspace/Album'
  state.upload = {
    selectedTrackerIds: ['redacted'],
    title: 'Album',
    artists: [{ name: 'Artist', importance: 1 }],
    year: 2020,
    media: 'WEB',
    tags: 'electronic',
    releaseType: 'Album',
    formats: [
      {
        id: 'source',
        label: 'FLAC',
        folderPath: '/workspace/Album',
        format: 'FLAC',
        bitrate: 'Lossless',
        otherBitrate: '',
        vbr: false,
        releaseDesc: '',
        logfileNames: []
      }
    ]
  }
  return state
}

describe('UploadSession tracker health gate', () => {
  it('stops before image hosting when a destination auth path is not ready', async () => {
    const cfg = defaultConfig()
    cfg.trackers.redacted = {
      ...cfg.trackers.redacted,
      enabled: true,
      siteUrl: 'https://redacted.example',
      announceUrl: 'https://announce.redacted.example',
      apiKey: 'api-key',
      sessionCookie: 'session-cookie'
    }
    mocks.healthcheckTrackers.mockResolvedValue([
      { id: 'trackers:redacted:api', name: 'Redacted API', status: 'available' },
      {
        id: 'trackers:redacted:session',
        name: 'Redacted Session',
        status: 'failing',
        detail: 'expired session'
      }
    ])

    const session = new UploadSession({
      appVersion: 'test',
      userDataPath: '',
      getConfig: () => cfg,
      trashItem: async () => undefined,
      tools: automaticToolResolver,
      send: () => undefined
    })
    const runtime = (session as unknown as { runtime: { apply: (next: State) => void } }).runtime
    runtime.apply(validState())
    vi.spyOn(session, 'ensureUploadReport').mockResolvedValue()
    const hostImages = vi.fn()
    ;(session as unknown as { hostImagesForSubmit: typeof hostImages }).hostImagesForSubmit = hostImages

    await expect(session.submitUpload()).resolves.toEqual({
      ok: false,
      error: 'Tracker health checks must pass before uploading: Redacted Session: expired session.'
    })
    expect(mocks.healthcheckTrackers).toHaveBeenCalledWith(cfg, ['redacted'])
    expect(hostImages).not.toHaveBeenCalled()
    expect(session.getState().upload.phase).toBe('failed')
  })
})
