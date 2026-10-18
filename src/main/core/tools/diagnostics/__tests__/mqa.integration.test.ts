import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { runCommand } from '../../runCommand'
import { checkMQA, plantSyncword } from '../mqa'

const SAMPLE_RATE = 48_000
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// One second of a stereo tone, with the marker in left XOR right when planted.
async function writeFlac(bits: 16 | 24, planted: boolean): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gravlax-mqa-'))
  roots.push(root)
  const bytes = bits / 8
  const marker = plantSyncword(SAMPLE_RATE, 20, 1000)
  const raw = Buffer.alloc(SAMPLE_RATE * 2 * bytes)
  for (let i = 0; i < SAMPLE_RATE; i++) {
    const tone = Math.round(Math.sin((i * 2 * Math.PI * 440) / SAMPLE_RATE) * 2 ** (bits - 3))
    const left = planted ? tone ^ (marker.left[i]! >> (32 - bits)) : tone
    raw.writeIntLE(left, i * 2 * bytes, bytes)
    raw.writeIntLE(tone, (i * 2 + 1) * bytes, bytes)
  }
  const rawPath = join(root, 'track.raw')
  const flacPath = join(root, 'track.flac')
  await writeFile(rawPath, raw)
  await runCommand('flac', [
    '--silent', '--force-raw-format', '--endian=little', '--sign=signed', '--channels=2',
    `--bps=${bits}`, `--sample-rate=${SAMPLE_RATE}`, '-o', flacPath, rawPath
  ])
  return flacPath
}

describe('checkMQA on a real FLAC', () => {
  it.each([16, 24] as const)('finds a planted marker in %i-bit audio', async (bits) => {
    expect(await checkMQA(await writeFlac(bits, true))).toBe(true)
    expect(await checkMQA(await writeFlac(bits, false))).toBe(false)
  })
})
