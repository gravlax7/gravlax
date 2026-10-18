import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlacStreamInfo } from '../../tools/flacLayout'
import {
  analyzeUpconvert,
  checkUpconvert,
  checkUpconvertWorkspace,
  parseWastedBits,
  upconvertSummaryDetail
} from '../upconvert'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function streamInfo(bitsPerSample: number): FlacStreamInfo {
  return {
    sampleRate: 44_100,
    channels: 2,
    bitsPerSample,
    totalSamples: 44_100,
    durationSeconds: 1
  }
}

async function workspace(...files: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gravlax-upconvert-'))
  roots.push(root)
  await Promise.all(files.map((file) => writeFile(join(root, file), 'fake flac')))
  return root
}

function subframes(values: number[], type: string): string {
  return values.map((value) => `subframe=0\twasted_bits=${value}\ttype=${type}\n`).join('')
}

describe('upconvert analysis', () => {
  it('parses wasted bits and skips silent subframes', () => {
    expect(
      parseWastedBits(
        'subframe=0\twasted_bits=2\ttype=LPC\nsubframe=1\twasted_bits=0\ttype=CONSTANT\nsubframe=0\twasted_bits=9\ttype=FIXED'
      )
    ).toEqual([2, 9])
  })

  it('flags a track when 90% of non-silent subframes have 8 or more wasted bits', async () => {
    const run = vi.fn(async () =>
      Buffer.from(subframes([...Array(9).fill(8), 0], 'FIXED') + subframes([0, 0, 0, 0], 'CONSTANT'))
    )
    await expect(analyzeUpconvert('/music/track.flac', { run })).resolves.toEqual({
      wastedBits: 8,
      isUpconverted: true
    })
  })

  it('does not flag a track below the 90% share', async () => {
    const run = vi.fn(async () => Buffer.from(subframes([...Array(8).fill(8), 0, 0], 'LPC')))
    await expect(analyzeUpconvert('/music/track.flac', { run })).resolves.toEqual({
      wastedBits: 8,
      isUpconverted: false
    })
  })

  it('does not flag seven wasted bits', async () => {
    const run = vi.fn(async () => Buffer.from(subframes([7, 7, 7], 'LPC')))
    await expect(analyzeUpconvert('/music/track.flac', { run })).resolves.toEqual({
      wastedBits: 7,
      isUpconverted: false
    })
  })

  it('does not flag a silent track', async () => {
    const run = vi.fn(async () => Buffer.from(subframes([0, 0], 'CONSTANT')))
    await expect(analyzeUpconvert('/music/track.flac', { run })).resolves.toEqual({
      wastedBits: 0,
      isUpconverted: false
    })
  })

  it('rejects analysis output without wasted-bit data', async () => {
    const run = vi.fn(async () => Buffer.from('frame=0'))
    await expect(analyzeUpconvert('/music/track.flac', { run })).rejects.toThrow(
      'Could not determine wasted bits.'
    )
  })

  it('skips 16-bit FLACs without running the analyzer', async () => {
    const run = vi.fn(async () => Buffer.from('wasted_bits=8'))
    await expect(
      checkUpconvert('/music/track.flac', {
        readInfo: async () => streamInfo(16),
        run
      })
    ).resolves.toBeNull()
    expect(run).not.toHaveBeenCalled()
  })

  it('reports command failures', async () => {
    const run = vi.fn(async () => {
      throw new Error('File appears to be corrupt')
    })
    await expect(analyzeUpconvert('/music/track.flac', { run })).rejects.toThrow(
      'File appears to be corrupt'
    )
  })

  it('passes cancellation to FLAC and preserves its abort error', async () => {
    const controller = new AbortController()
    const abortError = new DOMException('This operation was aborted', 'AbortError')
    const run = vi.fn(async (_name, _args, signal) => {
      expect(signal).toBe(controller.signal)
      throw abortError
    })
    await expect(
      analyzeUpconvert('/music/track.flac', { signal: controller.signal, run })
    ).rejects.toBe(abortError)
  })
})

describe('workspace upconvert checks', () => {
  it('checks only 24-bit files in a mixed release', async () => {
    const root = await workspace('01.flac', '02.flac')
    const analyze = vi.fn(async () => ({ wastedBits: 3, isUpconverted: false }))
    const summary = await checkUpconvertWorkspace(root, {
      readInfo: async (path) => streamInfo(basename(path) === '01.flac' ? 16 : 24),
      analyze
    })

    expect(summary).toEqual({
      checkedCount: 1,
      results: [
        { relativePath: '02.flac', bitDepth: 24, wastedBits: 3, isUpconverted: false }
      ],
      errors: []
    })
    expect(analyze).toHaveBeenCalledTimes(1)
  })

  it('keeps successful results when another 24-bit file fails', async () => {
    const root = await workspace('01.flac', '02.flac')
    const summary = await checkUpconvertWorkspace(root, {
      readInfo: async () => streamInfo(24),
      analyze: async (path) => {
        if (basename(path) === '02.flac') throw new Error('corrupt stream')
        return { wastedBits: 8, isUpconverted: true }
      }
    })

    expect(summary.checkedCount).toBe(2)
    expect(summary.results).toHaveLength(1)
    expect(summary.errors).toEqual([{ relativePath: '02.flac', message: 'corrupt stream' }])
    expect(upconvertSummaryDetail(summary)).toContain('Upconverts found in 1. Upload is blocked.')
    expect(upconvertSummaryDetail(summary)).toContain('Upconvert check errors (1)')
  })
})
