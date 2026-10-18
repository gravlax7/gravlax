import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { binaryAvailable, writeSyntheticFlac } from '../../tools/__tests__/helpers/audioFixture'
import { checkUpconvert } from '../upconvert'

describe('upconvert integration', () => {
  it.each([
    ['16-bit audio', { effectiveBits: 16 as const }, true],
    ['16-bit audio followed by silence', { effectiveBits: 16 as const, silenceSeconds: 1 }, true],
    ['24-bit audio', { effectiveBits: 24 as const }, false],
    ['digital silence', { durationSeconds: 0, silenceSeconds: 1 }, false]
  ])('checks a 24-bit FLAC holding %s when FLAC is available', async (_, audio, upconverted) => {
    if (!(await binaryAvailable('flac'))) return

    const root = await mkdtemp(join(tmpdir(), 'gravlax-upconvert-integration-'))
    try {
      const path = join(root, '01 - Tone.flac')
      await writeSyntheticFlac(path, {
        bitsPerSample: 24,
        distinctChannels: true,
        durationSeconds: 1,
        ...audio
      })
      const result = await checkUpconvert(path)
      expect(result).toMatchObject({ bitDepth: 24, isUpconverted: upconverted })
      if (upconverted) expect(result?.wastedBits).toBe(8)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
