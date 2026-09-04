import { access, copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import NodeID3 from 'node-id3'
import { writeSyntheticFlac } from '../../__tests__/helpers/audioFixture'
import { readFLACStreamInfo } from '@main/core/tools/diagnostics/mqa'
import { runCommand } from '../../runCommand'
import { convertFolder } from '../flacConvert'
import { transcodeFolder } from '../mp3'
import { buildDownconvertOutputPath, buildMp3OutputPath } from '../naming'
import { readFLACTags } from '@main/core/tags/extract'

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
      if (await binaryAvailable('metaflac')) {
        await runCommand('metaflac', [
          '--set-tag=DATE=2020-05-17',
          '--set-tag=ORIGINALDATE=2018-09-21',
          '--set-tag=LABEL=Label',
          join(album, '01 - Tone.flac')
        ])
      }
      const result = await transcodeFolder(album, 'V0', { concurrency: 1 })
      expect(result.outputPath).toContain('MP3 V0')
      const mp3 = join(result.outputPath, '01 - Tone.mp3')
      await access(mp3)
      const id3 = NodeID3.read(mp3) as {
        title?: string
        album?: string
        artist?: string
        year?: string
        originalYear?: string
        publisher?: string
        userDefinedText?: Array<{ description?: string; value?: string }>
      }
      expect(id3.title).toBe('Tone')
      expect(id3.album).toBe('Synthetic Test Audio')
      expect(id3.artist).toBe('Test Artist')
      if (await binaryAvailable('metaflac')) {
        expect(id3.year).toBe('2020')
        expect(id3.originalYear).toBe('2018')
        expect(id3.publisher).toBe('Label')
        expect(id3.userDefinedText).toEqual(
          expect.arrayContaining([
            { description: 'DATE', value: '2020-05-17' },
            { description: 'ORIGINALDATE', value: '2018-09-21' }
          ])
        )
      }
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
      if (await binaryAvailable('metaflac')) {
        await runCommand('metaflac', ['--set-tag=REPLAYGAIN_TRACK_GAIN=-7.00 dB', source])
      }
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
      if (await binaryAvailable('metaflac')) {
        const tags = await readFLACTags(outFile)
        expect(tags.values.TITLE).toEqual(['Tone'])
        expect(tags.values.REPLAYGAIN_TRACK_GAIN).toBeUndefined()
        expect(tags.values.ENCODER).toBeUndefined()
      }
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})

describe('transcode output reuse', () => {
  it('reuses a complete MP3 folder whose tags still match', async () => {
    const hasFlac = await binaryAvailable('flac')
    const hasLame = await binaryAvailable('lame')
    if (!hasFlac || !hasLame) return

    const root = await mkdtemp(join(tmpdir(), 'gravlax-skip-'))
    try {
      const album = join(root, 'Artist - Album [WEB FLAC]')
      await mkdir(join(album, 'CD1'), { recursive: true })
      await mkdir(join(album, 'CD2'), { recursive: true })
      await writeSyntheticFlac(join(album, 'CD1', '01 - Track.flac'))
      await copyFile(join(album, 'CD1', '01 - Track.flac'), join(album, 'CD2', '01 - Track.flac'))

      const first = await transcodeFolder(album, 'V0', { concurrency: 1 })
      const mp3 = join(first.outputPath, 'CD1', '01 - Track.mp3')
      const before = await stat(mp3)

      const second = await transcodeFolder(album, 'V0', { concurrency: 1 })
      expect(second.outputPath).toBe(first.outputPath)
      const after = await stat(mp3)
      expect(after.mtimeMs).toBe(before.mtimeMs)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)

  it('rebuilds MP3s when source tags change', async () => {
    const hasFlac = await binaryAvailable('flac')
    const hasLame = await binaryAvailable('lame')
    const hasMetaflac = await binaryAvailable('metaflac')
    if (!hasFlac || !hasLame || !hasMetaflac) return

    const root = await mkdtemp(join(tmpdir(), 'gravlax-stale-mp3-'))
    try {
      const album = join(root, 'Artist - Album [WEB FLAC]')
      await mkdir(album)
      const source = join(album, '01 - Tone.flac')
      await writeSyntheticFlac(source)
      const first = await transcodeFolder(album, 'V0', { concurrency: 1 })
      const mp3 = join(first.outputPath, '01 - Tone.mp3')
      expect((NodeID3.read(mp3) as { title?: string }).title).toBe('Tone')

      await runCommand('metaflac', ['--remove-tag=TITLE', '--set-tag=TITLE=Changed', source])
      await transcodeFolder(album, 'V0', { concurrency: 1 })
      expect((NodeID3.read(mp3) as { title?: string }).title).toBe('Changed')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)

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

      const out = buildMp3OutputPath(album, 'V0')
      await mkdir(join(out, 'CD1'), { recursive: true })
      await writeFile(join(out, 'CD1', '01 - Track.mp3'), 'x')

      await transcodeFolder(album, 'V0', { concurrency: 1 })
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
