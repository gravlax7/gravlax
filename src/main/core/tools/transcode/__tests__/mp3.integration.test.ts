import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeSyntheticFlac } from '../../__tests__/helpers/audioFixture'
import { readFLACStreamInfo } from '@main/core/tools/diagnostics/mqa'
import { convertFolder } from '../flacConvert'
import { transcodeFolder } from '../mp3'
import { buildDownconvertOutputPath, buildMp3OutputPath } from '../naming'

async function binaryAvailable(name: string): Promise<boolean> {
  for (const part of (process.env.PATH ?? '').split(delimiter)) {
    try {
      await access(join(part, name))
      return true
    } catch {
      /* continue */
    }
    if (process.platform === 'win32') {
      try {
        await access(join(part, `${name}.exe`))
        return true
      } catch {
        /* continue */
      }
    }
  }
  return false
}

describe('transcode integration', () => {
  it('encodes a FLAC fixture to MP3 V0 when binaries are available', async () => {
    const hasFlac = await binaryAvailable('flac')
    const hasLame = await binaryAvailable('lame')
    if (!hasFlac || !hasLame) {
      return
    }

    const root = await mkdtemp(join(tmpdir(), 'gravlax-transcode-'))
    try {
      const album = join(root, 'Artist - Album [WEB FLAC]')
      await mkdir(album)
      await writeSyntheticFlac(join(album, '01 - Tone.flac'))
      const result = await transcodeFolder(album, 'V0', { concurrency: 1 })
      expect(result.outputPath).toContain('MP3 V0')
      await access(join(result.outputPath, '01 - Tone.mp3'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)

  it('downconverts a FLAC fixture with sox when available', async () => {
    const hasSox = await binaryAvailable('sox')
    const hasFlac = await binaryAvailable('flac')
    if (!hasSox || !hasFlac) return

    const root = await mkdtemp(join(tmpdir(), 'gravlax-downconv-'))
    try {
      const album = join(root, 'Artist - Album [WEB 24bit FLAC]')
      await mkdir(album, { recursive: true })
      const source = join(album, '01 - Tone.flac')
      await writeSyntheticFlac(source, { bitsPerSample: 24, sampleRate: 96_000 })
      const info = await readFLACStreamInfo(source)
      const targetRate = info.sampleRate % 48000 === 0 ? 48000 : 44100
      const result = await convertFolder(album, {
        bitDepth: 16,
        sampleRate: targetRate,
        concurrency: 1
      })
      const outFile = join(result.outputPath, '01 - Tone.flac')
      await access(outFile)
      const outInfo = await readFLACStreamInfo(outFile)
      expect(outInfo.bitsPerSample).toBe(16)
      expect(outInfo.sampleRate).toBe(targetRate)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})

describe('transcode output reuse', () => {
  it('skips a multi-disc release whose nested MP3s are all present', async () => {
    const hasFlac = await binaryAvailable('flac')
    if (!hasFlac) return

    const root = await mkdtemp(join(tmpdir(), 'gravlax-skip-'))
    try {
      const album = join(root, 'Artist - Album [WEB FLAC]')
      await mkdir(join(album, 'CD1'), { recursive: true })
      await mkdir(join(album, 'CD2'), { recursive: true })
      await writeSyntheticFlac(join(album, 'CD1', '01 - Track.flac'))
      await copyFile(join(album, 'CD1', '01 - Track.flac'), join(album, 'CD2', '01 - Track.flac'))

      // Pre-create the full nested output so no MP3 encoder is needed on this path.
      const out = buildMp3OutputPath(album, 'V0')
      await mkdir(join(out, 'CD1'), { recursive: true })
      await mkdir(join(out, 'CD2'), { recursive: true })
      await writeFile(join(out, 'CD1', '01 - Track.mp3'), 'x')
      await writeFile(join(out, 'CD2', '01 - Track.mp3'), 'x')

      const result = await transcodeFolder(album, 'V0', { concurrency: 1 })
      expect(result.outputPath).toBe(out)
      // Placeholders untouched: the existing output was reused, not re-encoded.
      expect(await readFile(join(out, 'CD1', '01 - Track.mp3'), 'utf8')).toBe('x')
      expect(await readFile(join(out, 'CD2', '01 - Track.mp3'), 'utf8')).toBe('x')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 60_000)

  it('rebuilds when an existing MP3 output is incomplete', async () => {
    const hasFlac = await binaryAvailable('flac')
    const hasLame = await binaryAvailable('lame')
    if (!hasFlac || !hasLame) return

    const root = await mkdtemp(join(tmpdir(), 'gravlax-partial-'))
    try {
      const album = join(root, 'Artist - Album [WEB FLAC]')
      await mkdir(join(album, 'CD1'), { recursive: true })
      await mkdir(join(album, 'CD2'), { recursive: true })
      await writeSyntheticFlac(join(album, 'CD1', '01 - Track.flac'))
      await copyFile(join(album, 'CD1', '01 - Track.flac'), join(album, 'CD2', '01 - Track.flac'))

      // Only CD1 encoded — an aborted run must not be mistaken for a finished one.
      const out = buildMp3OutputPath(album, 'V0')
      await mkdir(join(out, 'CD1'), { recursive: true })
      await writeFile(join(out, 'CD1', '01 - Track.mp3'), 'x')

      await transcodeFolder(album, 'V0', { concurrency: 1 })
      // CD1's placeholder is gone, so the whole folder was rebuilt.
      expect(await readFile(join(out, 'CD1', '01 - Track.mp3'), 'utf8')).not.toBe('x')
      await access(join(out, 'CD2', '01 - Track.mp3'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)

  it('rebuilds when an existing downconvert output is incomplete', async () => {
    const hasSox = await binaryAvailable('sox')
    const hasFlac = await binaryAvailable('flac')
    if (!hasSox || !hasFlac) return

    const root = await mkdtemp(join(tmpdir(), 'gravlax-partial-conv-'))
    try {
      const album = join(root, 'Artist - Album [WEB 24bit FLAC]')
      await mkdir(album, { recursive: true })
      const source = join(album, '01 - Tone.flac')
      await writeSyntheticFlac(source, { bitsPerSample: 24, sampleRate: 96_000 })
      const info = await readFLACStreamInfo(source)
      const targetRate = info.sampleRate % 48000 === 0 ? 48000 : 44100

      // An empty output folder used to count as "already converted".
      const out = buildDownconvertOutputPath(album, 16, targetRate)
      await mkdir(out, { recursive: true })

      await convertFolder(album, {
        bitDepth: 16,
        sampleRate: targetRate,
        concurrency: 1
      })
      await access(join(out, '01 - Tone.flac'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})
