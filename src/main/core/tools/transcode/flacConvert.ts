import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BitDepth } from '@shared/types'
import { automaticToolResolver, type ToolResolver } from '@main/core/tools/binaries'
import { SOURCE_TORRENT_PLACEHOLDER } from '@main/core/tools/upload/descriptions'
import { readFLACTags } from '@main/core/tags/extract'
import { gatherTrackAudioInfo } from './audioInfo'
import { copyExtraFiles } from './extras'
import { buildDownconvertOutputPath } from './naming'
import { inspectOutputFolder } from './outputFolder'
import { resolveSampleRateFamily } from './options'
import { processFiles, type ProcessProgress } from './processFiles'
import {
  flacOutputMatchesSource,
  readFlacPictures,
  restoreFlacTagsAndPictures
} from './tags'

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

  const outputState = await inspectOutputFolder(
    newPath,
    items.map((item) => item.dst),
    '.flac'
  )
  if (outputState !== 'missing') {
    if (outputState === 'complete' && (await flacFolderMatchesSource(items))) {
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
      await restoreFlacTagsAndPictures(
        item.src,
        item.dst,
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
  sampleRate: number | null,
  bitDepth: BitDepth = 16,
  version: string
): string {
  if (sampleRate === null) return ''
  const depthArgs = SOX_DEPTH_ARGS[bitDepth].join(' ')
  const soxCmd = `sox input.flac ${depthArgs} output.flac rate -v -L ${sampleRate} dither`
  return (
    `${bitDepth} bit ${(sampleRate / 1000).toFixed(2)} kHz\n` +
    `[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}\n` +
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

async function flacFolderMatchesSource(items: readonly ConvertItem[]): Promise<boolean> {
  for (const item of items) {
    const source = await readFLACTags(item.src)
    const pictures = await readFlacPictures(item.src)
    if (!(await flacOutputMatchesSource(item.dst, source.values, pictures))) return false
  }
  return true
}
