import { spawn } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { BitDepth } from '@shared/types'
import { automaticToolResolver, type ToolResolver } from '@main/core/tools/binaries'
import { gatherTrackAudioInfo } from './audioInfo'
import { copyExtraFiles } from './extras'
import { buildDownconvertOutputPath } from './naming'
import { resolveSampleRateFamily } from './options'
import { processFiles, type ProcessProgress } from './processFiles'

export const SOX_DEPTH_ARGS: Record<BitDepth, string[]> = {
  16: ['-R', '-G', '-b', '16'],
  24: ['-R', '-G']
}

interface ConvertItem {
  src: string
  dst: string
  relativePath: string
  sampleRate: number
  targetRate: number
}

export interface ConvertFolderResult {
  sampleRate: number | null
  outputPath: string
}

export async function convertFolder(
  path: string,
  options: {
    bitDepth?: BitDepth
    sampleRate?: number | null
    essentialOnly?: boolean
    concurrency?: number
    signal?: AbortSignal
    onProgress?: (progress: ProcessProgress) => void
    tools?: ToolResolver
  } = {}
): Promise<ConvertFolderResult> {
  const bitDepth = options.bitDepth ?? 16
  const sampleRate = options.sampleRate ?? null
  const newPath = buildDownconvertOutputPath(path, bitDepth, sampleRate)

  const items = await collectConvertItems(path, newPath, sampleRate)
  const convertSrcs = new Set(items.map((item) => item.src))

  if (await pathExists(newPath)) {
    // An aborted conversion leaves a partial folder behind. Treating the folder's
    // mere existence as success would hand that partial release to the uploader.
    const expected = items.map((item) => outputKey(newPath, item.dst))
    const existing = await collectOutputKeys(newPath, '.flac')
    if (expected.length > 0 && expected.every((name) => existing.has(name))) {
      return { sampleRate, outputPath: newPath }
    }
    await rm(newPath, { recursive: true, force: true })
  }

  await mkdir(newPath, { recursive: true })
  await copyExtraFiles(path, newPath, {
    essentialOnly: options.essentialOnly,
    skipSources: convertSrcs
  })

  await processFiles(
    items,
    options.concurrency ?? 3,
    async (item) => {
      options.signal?.throwIfAborted()
      await mkdir(dirname(item.dst), { recursive: true })
      await runSox(
        item.src,
        item.dst,
        bitDepth,
        item.targetRate,
        options.signal,
        options.tools ?? automaticToolResolver
      )
    },
    options.onProgress,
    (item) => item.relativePath
  )

  const finalRate = items.length > 0 ? items[items.length - 1]!.targetRate : sampleRate
  return { sampleRate: finalRate, outputPath: newPath }
}

export function generateConversionDescription(
  url: string,
  sampleRate: number | null,
  bitDepth: BitDepth = 16,
  version = '0.1.0'
): string {
  if (sampleRate === null) return ''
  const depthArgs = SOX_DEPTH_ARGS[bitDepth].join(' ')
  const soxCmd = `sox input.flac ${depthArgs} output.flac rate -v -L ${sampleRate} dither`
  return (
    `Encode Specifics: ${bitDepth} bit ${(sampleRate / 1000).toFixed(2)} kHz\n` +
    `[b]Source:[/b] ${url}\n` +
    `[b]Transcode process:[/b] [code]${soxCmd}[/code]\n` +
    `[hr]Uploaded with [b]gravlax[/b] v${version}`
  )
}

async function collectConvertItems(
  path: string,
  newPath: string,
  sampleRate: number | null
): Promise<ConvertItem[]> {
  const tracks = await gatherTrackAudioInfo(path)
  const items: ConvertItem[] = []
  for (const track of tracks) {
    if (track.bitsPerSample !== 24) continue
    const targetRate = sampleRate ?? resolveSampleRateFamily(track.sampleRate)
    items.push({
      src: track.absolutePath,
      dst: join(newPath, ...track.relativePath.split('/')),
      relativePath: track.relativePath,
      sampleRate: track.sampleRate,
      targetRate
    })
  }
  return items
}

async function runSox(
  src: string,
  dst: string,
  bitDepth: BitDepth,
  targetRate: number,
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<void> {
  const args = [
    src,
    ...SOX_DEPTH_ARGS[bitDepth],
    dst,
    'rate',
    '-v',
    '-L',
    String(targetRate),
    'dither'
  ]

  const executable = await tools.require('sox')
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { signal })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(
        new Error(
          stderr.trim() || `sox conversion failed for ${src} with code ${code ?? 'unknown'}`
        )
      )
    })
  })
}

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

async function pathExists(path: string): Promise<boolean> {
  try {
    await readdir(path)
    return true
  } catch {
    return false
  }
}
