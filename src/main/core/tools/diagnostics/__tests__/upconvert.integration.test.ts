import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeSyntheticFlac } from '../../__tests__/helpers/audioFixture'
import { checkUpconvert } from '../upconvert'

async function binaryAvailable(name: string): Promise<boolean> {
  for (const part of (process.env.PATH ?? '').split(delimiter)) {
    try {
      await access(join(part, process.platform === 'win32' ? `${name}.exe` : name))
      return true
    } catch {
      /* continue */
    }
  }
  return false
}

describe('upconvert integration', () => {
  it('finds wasted bits in a 24-bit FLAC made from 16-bit samples when FLAC is available', async () => {
    if (!(await binaryAvailable('flac'))) return

    const root = await mkdtemp(join(tmpdir(), 'gravlax-upconvert-integration-'))
    try {
      const path = join(root, '01 - Tone.flac')
      await writeSyntheticFlac(path, {
        bitsPerSample: 24,
        effectiveBits: 16,
        distinctChannels: true
      })
      const result = await checkUpconvert(path)
      expect(result).toMatchObject({ bitDepth: 24, wastedBits: 8, isUpconverted: true })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
