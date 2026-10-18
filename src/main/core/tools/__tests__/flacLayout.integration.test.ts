import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { readFlacLayout } from '../flacLayout'
import { runCommand } from '../runCommand'
import { writeSyntheticFlac } from './helpers/audioFixture'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('readFlacLayout', () => {
  it('reads stream info, vendor and byte totals', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gravlax-layout-'))
    roots.push(root)
    const path = join(root, 'track.flac')
    await writeSyntheticFlac(path, { bitsPerSample: 24, sampleRate: 48_000, durationSeconds: 1 })

    const before = await readFlacLayout(path)
    expect(before.stream).toMatchObject({
      sampleRate: 48_000,
      channels: 2,
      bitsPerSample: 24,
      totalSamples: 48_000,
      durationSeconds: 1
    })
    expect(before.vendor).toMatch(/^reference libFLAC/)
    expect(before.comments.TITLE).toEqual(['Tone'])
    expect(before.pictureCount).toBe(0)

    const image = join(root, 'cover.png')
    await writeFile(image, Buffer.from(PNG, 'base64'))
    await runCommand('metaflac', ['--add-padding=5000', `--import-picture-from=${image}`, path])

    const after = await readFlacLayout(path)
    expect(after.pictureCount).toBe(1)
    expect(after.pictureBytes).toBeGreaterThan(Buffer.from(PNG, 'base64').length)
    expect(after.paddingBytes).toBeGreaterThanOrEqual(before.paddingBytes + 5000)
    expect(after.audioBytes).toBe(before.audioBytes)
    expect(after.audioBytes).toBeLessThan((await stat(path)).size)
  })
})
