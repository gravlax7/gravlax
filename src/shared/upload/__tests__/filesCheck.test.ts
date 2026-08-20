import { describe, expect, it } from 'vitest'
import type { FilesCheckSnapshot, LogCheck } from '../../types/upload'
import {
  hasLogErrors,
  hasLogIssues,
  hasLogResults,
  hasUpconvertResults,
  logHeadline,
  logScores,
  logTone,
  mqaHeadline,
  mqaTone,
  upconvertFindings,
  upconvertHeadline,
  upconvertTone
} from '../filesCheck'

function snapshot(overrides: Partial<FilesCheckSnapshot> = {}): FilesCheckSnapshot {
  return {
    status: 'ok',
    mqa: { checkedCount: 0, mqaPaths: [], errors: [] },
    upconvert: { checkedCount: 0, results: [], errors: [] },
    logs: { logFiles: [], checks: [] },
    ...overrides
  }
}

function check(overrides: Partial<LogCheck> = {}): LogCheck {
  return {
    relativePath: 'rip.log',
    trackerId: 'redacted',
    trackerName: 'Redacted',
    score: 100,
    issues: [],
    ...overrides
  }
}

describe('MQA reporting', () => {
  it('flags a release with MQA markers', () => {
    const s = snapshot({ mqa: { checkedCount: 4, mqaPaths: ['02.flac'], errors: [] } })
    expect(mqaHeadline(s)).toBe('MQA detected')
    expect(mqaTone(s)).toBe('warning')
  })

  it('passes a clean release', () => {
    const s = snapshot({ mqa: { checkedCount: 4, mqaPaths: [], errors: [] } })
    expect(mqaHeadline(s)).toBe('No MQA markers found')
    expect(mqaTone(s)).toBe('success')
  })

  it('says nothing either way when there were no FLACs to check', () => {
    const s = snapshot()
    expect(mqaHeadline(s)).toBe('No FLAC files for MQA checks')
    expect(mqaTone(s)).toBe('info')
  })
})

describe('upconvert reporting', () => {
  it('flags likely upconverts and lists their bare file names', () => {
    const s = snapshot({
      upconvert: {
        checkedCount: 2,
        results: [
          { relativePath: 'CD1/01.flac', bitDepth: 24, wastedBits: 8, isUpconverted: true },
          { relativePath: 'CD1/02.flac', bitDepth: 24, wastedBits: 2, isUpconverted: false }
        ],
        errors: []
      }
    })
    expect(upconvertHeadline(s)).toBe('Possible 24-bit upconvert detected')
    expect(upconvertTone(s)).toBe('warning')
    expect(upconvertFindings(s)).toEqual([
      { fileName: '01.flac', wastedBits: 8, bitDepth: 24 }
    ])
  })

  it('passes a clean 24-bit release', () => {
    const s = snapshot({
      upconvert: {
        checkedCount: 1,
        results: [
          { relativePath: '01.flac', bitDepth: 24, wastedBits: 7, isUpconverted: false }
        ],
        errors: []
      }
    })
    expect(upconvertHeadline(s)).toBe('No likely 24-bit upconverts found')
    expect(upconvertTone(s)).toBe('success')
  })

  it('warns when a file could not be checked', () => {
    const s = snapshot({
      upconvert: {
        checkedCount: 1,
        results: [],
        errors: [{ relativePath: '01.flac', message: 'corrupt' }]
      }
    })
    expect(upconvertHeadline(s)).toBe('Upconvert check incomplete')
    expect(upconvertTone(s)).toBe('warning')
    expect(hasUpconvertResults(s)).toBe(true)
  })

  it('hides the result when there are no 24-bit FLACs', () => {
    const s = snapshot()
    expect(upconvertHeadline(s)).toBe('No 24-bit FLAC files for upconvert checks')
    expect(upconvertTone(s)).toBe('info')
    expect(hasUpconvertResults(s)).toBe(false)
  })
})

describe('log scores', () => {
  it('lists one row per successful check, with the bare file name', () => {
    const s = snapshot({
      logs: {
        logFiles: ['CD1/disc.log'],
        checks: [check({ relativePath: 'CD1/disc.log', score: 97, trackerName: 'Orpheus' })]
      }
    })
    expect(logScores(s)).toEqual([{ tracker: 'Orpheus', fileName: 'disc.log', score: 97 }])
  })

  it('omits checks that errored', () => {
    const s = snapshot({
      logs: {
        logFiles: ['rip.log'],
        checks: [check({ score: undefined, error: 'auth failed' })]
      }
    })
    expect(logScores(s)).toEqual([])
  })
})

describe('log headline and tone', () => {
  it('reports a tracker that could not be reached as an error', () => {
    const s = snapshot({
      logs: { logFiles: ['rip.log'], checks: [check({ score: undefined, error: 'auth failed' })] }
    })
    expect(hasLogErrors(s)).toBe(true)
    expect(logHeadline(s)).toBe('Logchecker errors')
    expect(logTone(s)).toBe('warning')
  })

  it('celebrates a perfect rip', () => {
    const s = snapshot({ logs: { logFiles: ['rip.log'], checks: [check()] } })
    expect(logHeadline(s)).toBe('Perfect log scores')
    expect(logTone(s)).toBe('success')
  })

  it('treats an imperfect score as an issue', () => {
    const s = snapshot({ logs: { logFiles: ['rip.log'], checks: [check({ score: 59 })] } })
    expect(hasLogIssues(s)).toBe(true)
    expect(logHeadline(s)).toBe('Log score issues')
    expect(logTone(s)).toBe('warning')
  })

  // A 100 with listed issues is the case the old prose parser needed a
  // lookahead regex to spot.
  it('treats a listed issue on a perfect score as an issue', () => {
    const s = snapshot({
      logs: {
        logFiles: ['rip.log'],
        checks: [check({ score: 100, issues: ['Test and copy was not used'] })]
      }
    })
    expect(hasLogIssues(s)).toBe(true)
    expect(logHeadline(s)).toBe('Log score issues')
    expect(logTone(s)).toBe('warning')
  })

  it('reports a skipped run as skipped', () => {
    const s = snapshot({
      logs: { logFiles: [], checks: [], skippedReason: 'Logchecker runs for CD releases only.' }
    })
    expect(logHeadline(s)).toBe('Logchecker skipped')
    expect(logTone(s)).toBe('info')
    expect(hasLogResults(s)).toBe(true)
  })

  it('has nothing to show when logchecker never ran and was not skipped', () => {
    expect(hasLogResults(snapshot())).toBe(false)
  })
})
