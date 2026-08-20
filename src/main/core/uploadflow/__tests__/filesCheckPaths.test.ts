import { describe, expect, it } from 'vitest'
import {
  beginFilesApply,
  finishFilesApply,
  finishFilesRestore,
  initializeFiles,
  newState,
  setFilesCheck
} from '@main/core/uploadflow'

describe('files-check paths', () => {
  it('remaps upconvert results and errors when files are renamed and restored', () => {
    let state = initializeFiles(newState(), 'Album', ['01.flac', '02.flac'])
    state = beginFilesApply(state, [
      { id: 'track-1', relativePath: '01.flac' },
      { id: 'track-2', relativePath: '02.flac' }
    ])
    state = setFilesCheck(state, {
      status: 'ok',
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
      { changedFileCount: 2, strippedPictureCount: 0 }
    )
    expect(state.filesCheck.upconvert.results[0]?.relativePath).toBe('01 - First.flac')
    expect(state.filesCheck.upconvert.errors[0]?.relativePath).toBe('02 - Second.flac')
    expect(state.filesCheck.integrity.failures[0]?.relativePath).toBe('01 - First.flac')
    expect(state.filesCheck.integrity.repairedPaths).toEqual(['02 - Second.flac'])
    expect(state.filesCheck.integrity.repairErrors[0]?.relativePath).toBe('02 - Second.flac')

    state = finishFilesRestore(state, '/workspace/Album')
    expect(state.filesCheck.upconvert.results[0]?.relativePath).toBe('01.flac')
    expect(state.filesCheck.upconvert.errors[0]?.relativePath).toBe('02.flac')
    expect(state.filesCheck.integrity.failures[0]?.relativePath).toBe('01.flac')
    expect(state.filesCheck.integrity.repairedPaths).toEqual(['02.flac'])
    expect(state.filesCheck.integrity.repairErrors[0]?.relativePath).toBe('02.flac')
  })
})
