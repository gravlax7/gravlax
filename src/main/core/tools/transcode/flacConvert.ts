import { spawn } from 'node:child_process'
import { mkdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { BitDepth } from '@shared/types'
import { automaticToolResolver, type ToolResolver } from '@main/core/tools/binaries'
import {
  generateAudioDetails,
  SOURCE_TORRENT_PLACEHOLDER,
  type TrackDescInput
} from '@main/core/tools/upload/descriptions'
import { readFLACTags } from '@main/core/tags/extract'
import { gatherTrackAudioInfo } from './audioInfo'
import { copyExtraFiles } from './extras'
import { buildDownconvertOutputPath } from './naming'
import { inspectOutputFolder } from './outputFolder'
import { sampleRateFamily } from './options'
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
  targetRate?: number
}

interface SourceItem {
  src: string
  dst: string
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

  const { items, sources } = await collectConvertItems(path, newPath, sampleRate)
  const convertSrcs = new Set(items.map((item) => item.src))

  const outputState = await inspectOutputFolder(
    newPath,
    sources.map((item) => item.dst),
    '.flac'
  )
  if (outputState !== 'missing') {
    if (outputState === 'complete' && (await flacFolderMatchesSource(sources))) {
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

  const lastItem = items.at(-1)
  const finalRate = lastItem ? lastItem.targetRate ?? lastItem.sampleRate : sampleRate
  return { sampleRate: finalRate, outputPath: newPath }
}

export function generateConversionDescription(
  sampleRate: number | null,
  bitDepth: BitDepth = 16,
  version: string,
  tracks: TrackDescInput[] = []
): string {
  const depthArgs = SOX_DEPTH_ARGS[bitDepth].join(' ')
  const rates = tracks.map((track) => track.sampleRate ?? 0).filter((rate) => rate > 0)
  const depths = tracks.map((track) => track.bitDepth ?? 0).filter((depth) => depth > 0)
  const highestRate = rates.length > 0 ? Math.max(...rates) : sampleRate ?? 0
  const highestDepth = depths.length > 0 ? Math.max(...depths) : bitDepth
  const hybrid = new Set(rates).size > 1 || new Set(depths).size > 1
  if (highestRate === 0) return ''
  const process = sampleRate === null
    ? `SoX processes 24-bit tracks with ${depthArgs} and dither. For those tracks, it resamples rates in the 44.1 kHz family to 44.1 kHz and rates in the 48 kHz family to 48 kHz. Other rates stay unchanged. Existing 16-bit FLAC tracks are copied unchanged.\n`
    : `[code]sox input.flac ${depthArgs} output.flac rate -v -L ${sampleRate} dither[/code]\n`
  return (
    generateAudioDetails({
      bitDepth: highestDepth,
      sampleRate: highestRate,
      hybrid,
      tracks
    }) +
    `[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}\n` +
    `[b]Transcode process:[/b] ${process}` +
    `[hr]Uploaded with [b]gravlax[/b] v${version}`
  )
}

async function collectConvertItems(
  path: string,
  newPath: string,
  sampleRate: number | null
): Promise<{ items: ConvertItem[]; sources: SourceItem[] }> {
  const tracks = await gatherTrackAudioInfo(path)
  const items: ConvertItem[] = []
  const sources: SourceItem[] = []
  for (const track of tracks) {
    const dst = join(newPath, ...track.relativePath.split('/'))
    sources.push({ src: track.absolutePath, dst })
    if (track.bitsPerSample !== 24) continue
    const targetRate = sampleRate ?? sampleRateFamily(track.sampleRate)
    items.push({
      src: track.absolutePath,
      dst,
      relativePath: track.relativePath,
      sampleRate: track.sampleRate,
      targetRate
    })
  }
  return { items, sources }
}

async function runSox(
  src: string,
  dst: string,
  bitDepth: BitDepth,
  targetRate: number | undefined,
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<void> {
  const rateArgs = targetRate ? ['rate', '-v', '-L', String(targetRate)] : []
  const args = [src, ...SOX_DEPTH_ARGS[bitDepth], dst, ...rateArgs, 'dither']

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

async function flacFolderMatchesSource(items: readonly SourceItem[]): Promise<boolean> {
  for (const item of items) {
    const source = await readFLACTags(item.src)
    const pictures = await readFlacPictures(item.src)
    if (!(await flacOutputMatchesSource(item.dst, source.values, pictures))) return false
  }
  return true
}
