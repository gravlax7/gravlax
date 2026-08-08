import { describe, expect, it } from 'vitest'
import { emptyFlaccheckSummary, flaccheckSummaryDetail, parseFlaccheckJson } from '../flaccheck'

describe('flaccheck parser', () => {
  it('parses ScanReport results with transcode_verdict and hires_verdict', () => {
    const raw = JSON.stringify({
      results: [
        { path: '/tmp/ws/01.flac', transcode_verdict: 'GENUINE', hires_verdict: 'GENUINE_HIRES' },
        { path: '/tmp/ws/disc2/02.flac', transcode_verdict: 'TRANSCODED', hires_verdict: 'UNKNOWN' },
        { path: '/tmp/ws/03.flac', transcode_verdict: 'SUSPICIOUS', hires_verdict: 'PADDED_DEPTH' },
        { path: '/tmp/ws/04.flac', transcode_verdict: 'INCONCLUSIVE', hires_verdict: 'UPSAMPLED' }
      ],
      skipped: [],
      errors: []
    })
    const files = parseFlaccheckJson(raw, '/tmp/ws')
    expect(files).toEqual([
      { path: '01.flac', verdict: 'GENUINE', hiresVerdict: 'GENUINE_HIRES' },
      { path: '03.flac', verdict: 'SUSPICIOUS', hiresVerdict: 'PADDED_DEPTH' },
      { path: '04.flac', verdict: 'INCONCLUSIVE', hiresVerdict: 'UPSAMPLED' },
      { path: 'disc2/02.flac', verdict: 'TRANSCODED', hiresVerdict: 'UNKNOWN' }
    ])
  })

  it('defaults missing hires_verdict to UNKNOWN', () => {
    const raw = JSON.stringify([{ file: '/tmp/ws/a.flac', verdict: 'transcoded' }])
    expect(parseFlaccheckJson(raw, '/tmp/ws')).toEqual([
      { path: 'a.flac', verdict: 'TRANSCODED', hiresVerdict: 'UNKNOWN' }
    ])
  })

  it('skips rows without a known verdict', () => {
    const raw = JSON.stringify({
      results: [{ path: '/tmp/ws/a.flac', transcode_verdict: 'MAYBE' }, { path: '', transcode_verdict: 'GENUINE' }]
    })
    expect(parseFlaccheckJson(raw, '/tmp/ws')).toEqual([])
  })

  it('throws on invalid JSON', () => {
    expect(() => parseFlaccheckJson('{', '/tmp/ws')).toThrow('invalid JSON')
  })
})

describe('flaccheckSummaryDetail', () => {
  it('omits skipped and idle summaries', () => {
    expect(flaccheckSummaryDetail(emptyFlaccheckSummary())).toBe('')
    expect(flaccheckSummaryDetail({ status: 'skipped', checkedCount: 0, files: [] })).toBe('')
  })

  it('reports clean and failed results', () => {
    expect(
      flaccheckSummaryDetail({
        status: 'ok',
        checkedCount: 2,
        files: [
          { path: 'a.flac', verdict: 'GENUINE', hiresVerdict: 'UNKNOWN' },
          { path: 'b.flac', verdict: 'INCONCLUSIVE', hiresVerdict: 'GENUINE_HIRES' }
        ]
      })
    ).toBe('flaccheck: no lossy transcode indicators.')

    expect(
      flaccheckSummaryDetail({
        status: 'failed',
        checkedCount: 0,
        files: [],
        message: 'boom'
      })
    ).toBe('flaccheck: check failed (boom)')
  })

  it('summarizes lossy and fake hi-res separately', () => {
    const summary = {
      status: 'ok' as const,
      checkedCount: 4,
      files: [
        { path: 'a.flac', verdict: 'TRANSCODED' as const, hiresVerdict: 'UNKNOWN' as const },
        { path: 'b.flac', verdict: 'SUSPICIOUS' as const, hiresVerdict: 'UNKNOWN' as const },
        { path: 'c.flac', verdict: 'SUSPICIOUS' as const, hiresVerdict: 'PADDED_DEPTH' as const },
        { path: 'd.flac', verdict: 'GENUINE' as const, hiresVerdict: 'UPSAMPLED' as const }
      ]
    }
    expect(flaccheckSummaryDetail(summary)).toBe(
      'flaccheck: 1 likely transcoded, 1 suspicious, 1 padded bit depth, 1 upsampled.'
    )
  })
})
