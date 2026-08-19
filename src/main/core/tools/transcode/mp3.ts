import { spawn } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { Bitrate } from '@shared/types'
import { automaticToolResolver, type ToolResolver } from '@main/core/tools/binaries'
import { discoverFLACFiles } from '@main/core/tools/flacFiles'
import { readFLACStreamInfo } from '@main/core/tools/diagnostics/mqa'
import { SOURCE_TORRENT_PLACEHOLDER } from '@main/core/tools/upload/descriptions'
import { SKIP_EXTENSIONS } from './audioInfo'
import { copyExtraFiles } from './extras'
import { buildMp3OutputPath } from './naming'
import { processFiles, type ProcessProgress } from './processFiles'
import { readFlacPictures, readPreparedFlacTags, writeMp3Tags } from './tags'

export const LAME_COMMAND_MAP: Record<Bitrate, string[]> = {
  V0: ['-V', '0', '--vbr-new'],
  '320': ['-h', '-b', '320']
}

interface TranscodeItem {
  src: string
  dst: string
  relativePath: string
  channels: number
  tags: Record<string, string[]>
}

export interface TranscodeFolderResult {
  outputPath: string
}

export async function transcodeFolder(
  path: string,
  bitrate: Bitrate,
  options: {
    essentialOnly?: boolean
    concurrency?: number
    signal?: AbortSignal
    onProgress?: (progress: ProcessProgress) => void
    tools?: ToolResolver
  } = {}
): Promise<TranscodeFolderResult> {
  const newPath = buildMp3OutputPath(path, bitrate)
  const items = await collectTranscodeItems(path, newPath)

  if (await pathExists(newPath)) {
    const expected = items.map((item) => outputKey(newPath, item.dst))
    const existing = await collectOutputKeys(newPath, '.mp3')
    if (expected.length > 0 && expected.every((name) => existing.has(name))) {
      return { outputPath: newPath }
    }
    await rm(newPath, { recursive: true, force: true })
  }

  await mkdir(newPath, { recursive: true })
  await copyExtraFiles(path, newPath, {
    essentialOnly: options.essentialOnly,
    skipFlac: true,
    skipExtensions: SKIP_EXTENSIONS
  })

  await processFiles(
    items,
    options.concurrency ?? 3,
    async (item) => {
      options.signal?.throwIfAborted()
      if (item.channels > 2) {
        throw new Error(`${item.src} has ${item.channels} channels. Cannot convert to MP3.`)
      }
      await flacToMp3(
        bitrate,
        item.src,
        item.dst,
        options.signal,
        options.tools ?? automaticToolResolver
      )
      const pictures = await readFlacPictures(item.src)
      writeMp3Tags(item.dst, item.tags, pictures)
    },
    options.onProgress,
    (item) => item.relativePath
  )

  return { outputPath: newPath }
}

export function generateTranscodeDescription(bitrate: Bitrate, version: string): string {
  const lameCommand = LAME_COMMAND_MAP[bitrate].join(' ')
  return (
    `[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}\n` +
    `[b]Transcode process:[/b] ` +
    `[code]flac -Vdsc -- input.flac | lame -S ${lameCommand} --ignore-tag-errors - output.mp3[/code]\n` +
    `[hr]Uploaded with [b]gravlax[/b] v${version}`
  )
}

async function collectTranscodeItems(path: string, newPath: string): Promise<TranscodeItem[]> {
  const files = await discoverFLACFiles(path)
  const items: TranscodeItem[] = []
  for (const file of files) {
    const stream = await readFLACStreamInfo(file.absolutePath)
    const { tags, hasTags } = await readPreparedFlacTags(file.absolutePath)
    if (!hasTags) {
      throw new Error(`FLAC file has no tags: ${file.absolutePath}`)
    }
    const relMp3 = file.relativePath.replace(/\.flac$/i, '.mp3')
    items.push({
      src: file.absolutePath,
      dst: join(newPath, relMp3),
      relativePath: file.relativePath,
      channels: stream.channels,
      tags
    })
  }
  return items
}

async function flacToMp3(
  bitrate: Bitrate,
  flacPath: string,
  mp3Path: string,
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<void> {
  await mkdir(dirname(mp3Path), { recursive: true })

  const { flacExecutable, lameExecutable } = await resolveMp3Executables(tools)

  await new Promise<void>((resolve, reject) => {
    const flac = spawn(flacExecutable, ['-Vdsc', '-o', '-', flacPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
      signal
    })
    const lame = spawn(
      lameExecutable,
      [...LAME_COMMAND_MAP[bitrate], '--quiet', '--add-id3v2', '--ignore-tag-errors', '-', mp3Path],
      { stdio: ['pipe', 'ignore', 'pipe'], signal }
    )

    let flacErr = ''
    let lameErr = ''
    flac.stderr.on('data', (chunk: Buffer) => {
      flacErr += chunk.toString('utf8')
    })
    lame.stderr.on('data', (chunk: Buffer) => {
      lameErr += chunk.toString('utf8')
    })

    flac.stdout.pipe(lame.stdin)

    flac.on('error', reject)
    lame.on('error', (err) => {
      flac.kill()
      reject(err)
    })

    let flacCode: number | null = null
    let lameCode: number | null = null
    const maybeDone = (): void => {
      if (flacCode === null || lameCode === null) return
      if (flacCode !== 0) {
        reject(new Error(flacErr.trim() || `FLAC decoding failed with code ${flacCode}`))
        return
      }
      if (lameCode !== 0) {
        reject(new Error(lameErr.trim() || 'LAME encoding failed'))
        return
      }
      resolve()
    }

    flac.on('close', (code) => {
      flacCode = code ?? 1
      if (!lame.stdin.destroyed) lame.stdin.end()
      maybeDone()
    })
    lame.on('close', (code) => {
      lameCode = code ?? 1
      maybeDone()
    })
  })
}

export async function resolveMp3Executables(
  tools: ToolResolver
): Promise<{ flacExecutable: string; lameExecutable: string }> {
  const [flacExecutable, lameExecutable] = await Promise.all([
    tools.require('flac'),
    tools.require('lame')
  ])
  return { flacExecutable, lameExecutable }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}

// Multi-disc releases nest their tracks, so comparing bare filenames both misses
// existing output and collides across discs. Compare paths relative to the
// output root instead.
function outputKey(root: string, path: string): string {
  return relative(root, path).split(sep).join('/').toLowerCase()
}

async function collectOutputKeys(root: string, extension: string): Promise<Set<string>> {
  const keys = new Set<string>()
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile()) continue
      if (!entry.name.toLowerCase().endsWith(extension)) continue
      keys.add(outputKey(root, path))
    }
  }
  await walk(root)
  return keys
}
