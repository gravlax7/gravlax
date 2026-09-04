import { describe, expect, it } from 'vitest'
import {
  beginFilesApply,
  finishFilesApply,
  initializeFiles,
  newState,
  setFileChecks
} from '@main/core/uploadflow'

describe('file-checks paths', () => {
  it('remaps upconvert results and errors when files are renamed', () => {
    let state = initializeFiles(newState(), 'Album', ['01.flac', '02.flac'])
    state = beginFilesApply(state)
    state = setFileChecks(state, {
      status: 'ok',
      structure: { ready: true, issues: [], approvedPaths: [], emptyDirectories: [], quarantined: [] },
      integrity: {
        status: 'failed',
        checkedCount: 2,
        failures: [{ relativePath: '01.flac', message: 'unset MD5' }],
        repairedPaths: ['02.flac'],
        repairErrors: [{ relativePath: '02.flac', message: 'encode failed' }]
      },
      mqa: { checkedCount: 2, mqaPaths: ['01.flac'], errors: [] },
      upconvert: {
        checkedCount: 2,
        results: [
          { relativePath: '01.flac', bitDepth: 24, wastedBits: 8, isUpconverted: true }
        ],
        errors: [{ relativePath: '02.flac', message: 'corrupt stream' }]
      },
      logs: { logFiles: [], checks: [] }
    })

    state = finishFilesApply(
      state,
      '/workspace/Renamed Album',
      'Renamed Album',
      [
        { id: 'track-1', currentPath: '01 - First.flac' },
        { id: 'track-2', currentPath: '02 - Second.flac' }
      ],
      'hash',
      { changedFileCount: 2, strippedPictureCount: 0 },
      []
    )
    expect(state.fileChecks.upconvert.results[0]?.relativePath).toBe('01 - First.flac')
    expect(state.fileChecks.upconvert.errors[0]?.relativePath).toBe('02 - Second.flac')
    expect(state.fileChecks.integrity.failures[0]?.relativePath).toBe('01 - First.flac')
    expect(state.fileChecks.integrity.repairedPaths).toEqual(['02 - Second.flac'])
    expect(state.fileChecks.integrity.repairErrors[0]?.relativePath).toBe('02 - Second.flac')
  })
})
