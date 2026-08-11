import { describe, expect, it } from 'vitest'
import type { UploadFlowStateJSON } from '../../types/upload'
import {
  activeBackgroundTasks,
  canNavigateToStep,
  highestReachableStep,
  stepHasError,
  stepIndexOf,
  stepNodeStatus,
  UPLOAD_STEPS
} from '../stepGating'

function baseState(overrides: Partial<UploadFlowStateJSON> = {}): UploadFlowStateJSON {
  return {
    currentStep: 0,
    draft: {
      sourcePath: '',
      workspacePath: '',
      sourceMedia: '',
      lossyMaster: false,
      lossyComment: '',
      spectralIds: [],
      spectralIdsAuto: true
    },
    background: { sourcePath: '', sourceMedia: '', tasks: [] },
    metadata: {},
    tags: {},
    files: {
      original: { captured: false, coverCaptured: false, folderName: '', files: [] },
      apply: { phase: 'idle', onDiskModified: false, stripEmbeddedCoverArt: true, renameReleaseFolder: true, currentFolderName: '', files: [] }
    },
    transcode: {},
    filesCheck: {
      status: 'idle',
      mqa: { checkedCount: 0, mqaPaths: [], errors: [] },
      logs: { logFiles: [], checks: [] }
    },
    upload: {},
    seed: { phase: 'idle', tasks: [] },
    ...overrides
  }
}

describe('highestReachableStep', () => {
  it('stays at 0 without source', () => {
    expect(highestReachableStep(baseState())).toBe(0)
  })

  it('starts at files-check once a source folder is picked', () => {
    expect(
      highestReachableStep(
        baseState({
          draft: {
            sourcePath: '/a',
            workspacePath: '/w',
            sourceMedia: '',
            lossyMaster: false,
            lossyComment: '',
            spectralIds: [],
            spectralIdsAuto: true
          }
        })
      )
    ).toBe(0)
  })

  it('advances after files-check succeeds', () => {
    expect(
      highestReachableStep(
        baseState({
          draft: {
            sourcePath: '/a',
            workspacePath: '/w',
            sourceMedia: 'WEB',
            lossyMaster: false,
            lossyComment: '',
            spectralIds: [],
            spectralIdsAuto: true
          },
          background: {
            sourcePath: '/a',
            sourceMedia: 'WEB',
            tasks: [
              {
                id: 'files-check',
                step: 'files-check',
                title: 'Files',
                status: 'succeeded',
                detail: 'ok',
                progressCurrent: 1,
                progressTotal: 1,
                progressLabel: ''
              }
            ]
          }
        })
      )
    ).toBe(1)
  })

  it('does not gate on a failed files-check', () => {
    const draft = {
      sourcePath: '/a',
      workspacePath: '/w',
      sourceMedia: 'WEB' as const,
      lossyMaster: false,
      lossyComment: '',
      spectralIds: [],
      spectralIdsAuto: true
    }
    const state = baseState({
      draft,
      background: {
        sourcePath: '/a',
        sourceMedia: 'WEB',
        tasks: [
          {
            id: 'files-check',
            step: 'files-check',
            title: 'Files',
            status: 'failed',
            detail: 'logchecker unreachable',
            progressCurrent: 0,
            progressTotal: 0,
            progressLabel: ''
          },
          {
            id: 'spectrals',
            step: 'spectrals',
            title: 'Spectrals',
            status: 'succeeded',
            detail: 'ok',
            progressCurrent: 1,
            progressTotal: 1,
            progressLabel: ''
          }
        ]
      }
    })
    // Spectrals succeeded, so metadata is reachable despite the files-check error.
    expect(highestReachableStep(state)).toBe(2)
    expect(stepHasError(0, state)).toBe(true)
  })

  it('unlocks seed only after upload is done', () => {
    const draft = {
      sourcePath: '/a',
      workspacePath: '/w',
      sourceMedia: 'WEB' as const,
      lossyMaster: false,
      lossyComment: '',
      spectralIds: [],
      spectralIdsAuto: true
    }
    const withTranscodeDone = baseState({
      draft,
      tags: { proposed: { title: 'A' } },
      transcode: { phase: 'done' },
      upload: { phase: 'ready' }
    })
    expect(highestReachableStep(withTranscodeDone)).toBe(5)
    expect(
      highestReachableStep(
        baseState({
          draft,
          tags: { proposed: { title: 'A' } },
          transcode: { phase: 'done' },
          upload: { phase: 'done' }
        })
      )
    ).toBe(6)
  })

  // setTagsReleaseLoading parks `proposed: {}` in state, and `{}` is truthy.
  it('does not unlock transcode for an empty proposed release', () => {
    const draft = {
      sourcePath: '/a',
      workspacePath: '/w',
      sourceMedia: 'WEB' as const,
      lossyMaster: false,
      lossyComment: '',
      spectralIds: [],
      spectralIdsAuto: true
    }
    const metadata = { selected: { url: 'https://example.test/release' } }
    expect(
      highestReachableStep(
        baseState({ draft, metadata, tags: { proposed: {}, releaseStatus: 'loading' } })
      )
    ).toBe(3)
    expect(
      highestReachableStep(
        baseState({ draft, metadata, tags: { proposed: { title: 'A' }, releaseStatus: 'loading' } })
      )
    ).toBe(4)
  })
})

describe('stepIndexOf', () => {
  it('resolves ids against UPLOAD_STEPS', () => {
    expect(UPLOAD_STEPS).toHaveLength(7)
    expect(stepIndexOf('files-check')).toBe(0)
    expect(stepIndexOf('upload')).toBe(5)
    expect(stepIndexOf('seed')).toBe(UPLOAD_STEPS.length - 1)
  })
})

describe('stepHasError', () => {
  it('marks the upload step when a submit was rejected', () => {
    expect(stepHasError(5, baseState({ upload: { phase: 'failed', error: 'boom' } }))).toBe(true)
    expect(stepHasError(5, baseState({ upload: { phase: 'ready' } }))).toBe(false)
    expect(stepNodeStatus(5, baseState({ currentStep: 6, upload: { phase: 'failed' } }))).toBe(
      'error'
    )
  })
})

describe('canNavigateToStep', () => {
  it('allows backward always', () => {
    const state = baseState({ currentStep: 3 })
    expect(canNavigateToStep(0, state)).toBe(true)
    expect(canNavigateToStep(2, state)).toBe(true)
  })

  it('blocks spectrals until source media is chosen', () => {
    const state = baseState({
      currentStep: 0,
      draft: {
        sourcePath: '/a',
        workspacePath: '/w',
        sourceMedia: '',
        lossyMaster: false,
        lossyComment: '',
        spectralIds: [],
        spectralIdsAuto: true
      }
    })
    expect(canNavigateToStep(0, state)).toBe(true)
    expect(canNavigateToStep(1, state)).toBe(false)
  })

  it('limits forward to highest + 1', () => {
    const state = baseState({
      currentStep: 0,
      draft: {
        sourcePath: '/a',
        workspacePath: '/w',
        sourceMedia: 'WEB',
        lossyMaster: false,
        lossyComment: '',
        spectralIds: [],
        spectralIdsAuto: true
      }
    })
    expect(canNavigateToStep(1, state)).toBe(true)
    expect(canNavigateToStep(2, state)).toBe(false)
  })

  it('blocks seed until the upload succeeds', () => {
    const state = baseState({
      currentStep: 5,
      draft: {
        sourcePath: '/a',
        workspacePath: '/w',
        sourceMedia: 'WEB',
        lossyMaster: false,
        lossyComment: '',
        spectralIds: [],
        spectralIdsAuto: true
      },
      transcode: { phase: 'done' },
      upload: { phase: 'ready' }
    })

    expect(canNavigateToStep(6, state)).toBe(false)
    expect(canNavigateToStep(6, { ...state, upload: { phase: 'done' } })).toBe(true)
  })
})

describe('stepNodeStatus', () => {
  it('marks current step', () => {
    expect(stepNodeStatus(2, baseState({ currentStep: 2 }))).toBe('current')
  })

  it('marks past steps done', () => {
    expect(stepNodeStatus(0, baseState({ currentStep: 2 }))).toBe('done')
  })

  it('marks future steps upcoming', () => {
    expect(stepNodeStatus(5, baseState({ currentStep: 1 }))).toBe('upcoming')
  })

  it('marks failed prerequisite as error', () => {
    const state = baseState({
      currentStep: 0,
      background: {
        sourcePath: '',
        sourceMedia: '',
        tasks: [
          {
            id: 'files-check',
            step: 'files-check',
            title: 'Files',
            status: 'failed',
            detail: 'boom',
            progressCurrent: 0,
            progressTotal: 0,
            progressLabel: ''
          }
        ]
      }
    })
    expect(stepNodeStatus(0, state)).toBe('current')
    expect(stepNodeStatus(0, { ...state, currentStep: 1 })).toBe('error')
  })
})

describe('activeBackgroundTasks', () => {
  it('filters to queued and running', () => {
    const tasks = activeBackgroundTasks([
      {
        id: 'files-check',
        step: 'files-check',
        title: 'A',
        status: 'running',
        detail: '',
        progressCurrent: 0,
        progressTotal: 0,
        progressLabel: ''
      },
      {
        id: 'spectrals',
        step: 'spectrals',
        title: 'B',
        status: 'succeeded',
        detail: '',
        progressCurrent: 1,
        progressTotal: 1,
        progressLabel: ''
      },
      {
        id: 'metadata',
        step: 'metadata',
        title: 'C',
        status: 'queued',
        detail: '',
        progressCurrent: 0,
        progressTotal: 0,
        progressLabel: ''
      }
    ])
    expect(tasks.map((t) => t.id)).toEqual(['files-check', 'metadata'])
  })
})
