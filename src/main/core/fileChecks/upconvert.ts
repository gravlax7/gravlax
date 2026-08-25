import type { UpconvertCheckResult, UpconvertSummary } from '@shared/types'
import { automaticToolResolver, type ToolResolver } from '@main/core/tools/binaries'
import { discoverFLACFiles } from '@main/core/tools/flacFiles'
import { runCommand } from '@main/core/tools/runCommand'
import { readFLACStreamInfo, type FlacStreamInfo } from '../tools/diagnostics/mqa'

const UPCONVERT_WASTED_BITS = 8

type CommandRunner = typeof runCommand
type StreamInfoReader = (path: string) => Promise<FlacStreamInfo>

export interface UpconvertAnalysis {
  wastedBits: number
  isUpconverted: boolean
}

export function parseWastedBits(output: string): number[] {
  return Array.from(output.matchAll(/wasted_bits=(\d+)/g), (match) => Number(match[1]))
}

export async function analyzeUpconvert(
  path: string,
  options: {
    signal?: AbortSignal
    tools?: ToolResolver
    run?: CommandRunner
  } = {}
): Promise<UpconvertAnalysis> {
  const run = options.run ?? runCommand
  const output = await run(
    'flac',
    ['-ac', path],
    options.signal,
    undefined,
    options.tools ?? automaticToolResolver
  )
  const values = parseWastedBits(output.toString('utf8'))
  if (values.length === 0) {
    throw new Error('Could not determine wasted bits.')
  }
  const wastedBits = Math.ceil(values.reduce((sum, value) => sum + value, 0) / values.length)
  return { wastedBits, isUpconverted: wastedBits >= UPCONVERT_WASTED_BITS }
}

export async function checkUpconvert(
  path: string,
  options: {
    signal?: AbortSignal
    tools?: ToolResolver
    readInfo?: StreamInfoReader
    run?: CommandRunner
  } = {}
): Promise<Omit<UpconvertCheckResult, 'relativePath'> | null> {
  const info = await (options.readInfo ?? readFLACStreamInfo)(path)
  if (info.bitsPerSample !== 24) return null
  const analysis = await analyzeUpconvert(path, options)
  return { bitDepth: info.bitsPerSample, ...analysis }
}

export async function checkUpconvertWorkspace(
  path: string,
  options: {
    signal?: AbortSignal
    tools?: ToolResolver
    readInfo?: StreamInfoReader
    analyze?: (path: string, signal?: AbortSignal) => Promise<UpconvertAnalysis>
    onProgress?: (current: number, total: number, label: string) => void
  } = {}
): Promise<UpconvertSummary> {
  if (!path) throw new Error('workspace path is required')

  const files = await discoverFLACFiles(path)
  const summary: UpconvertSummary = { checkedCount: 0, results: [], errors: [] }
  const readInfo = options.readInfo ?? readFLACStreamInfo
  const analyze =
    options.analyze ??
    ((filePath: string, signal?: AbortSignal) =>
      analyzeUpconvert(filePath, { signal, tools: options.tools }))

  options.onProgress?.(
    0,
    files.length,
    files.length === 0 ? 'No FLAC files' : 'Checking for 24-bit upconverts…'
  )
  for (let i = 0; i < files.length; i++) {
    options.signal?.throwIfAborted()
    const file = files[i]!
    options.onProgress?.(i, files.length, file.relativePath)
    try {
      const info = await readInfo(file.absolutePath)
      if (info.bitsPerSample === 24) {
        summary.checkedCount++
        const result = await analyze(file.absolutePath, options.signal)
        summary.results.push({
          relativePath: file.relativePath,
          bitDepth: info.bitsPerSample,
          ...result
        })
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error
      summary.errors.push({
        relativePath: file.relativePath,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    options.onProgress?.(i + 1, files.length, file.relativePath)
  }
  return summary
}

export function upconvertSummaryDetail(summary: UpconvertSummary): string {
  if (summary.checkedCount === 0 && summary.errors.length === 0) {
    return 'No 24-bit FLAC files found for upconvert checks.'
  }

  const upconverts = summary.results.filter((result) => result.isUpconverted)
  let headline = `Checked ${summary.checkedCount} 24-bit FLAC files. No likely upconverts found.`
  if (upconverts.length > 0) {
    headline = `Checked ${summary.checkedCount} 24-bit FLAC files. Possible upconverts detected in ${upconverts.length}.`
  } else if (summary.errors.length > 0) {
    headline = `Checked ${summary.checkedCount} 24-bit FLAC files. Upconvert check incomplete.`
  }
  const lines = [headline]
  for (const result of summary.results) {
    lines.push(
      `- ${result.relativePath}: ${result.isUpconverted ? 'likely upconverted' : 'passed'} (wasted bits: ${result.wastedBits}/${result.bitDepth})`
    )
  }
  if (summary.errors.length > 0) {
    lines.push(`Upconvert check errors (${summary.errors.length}):`)
    for (const error of summary.errors) {
      lines.push(`- ${error.relativePath}: ${error.message}`)
    }
  }
  return lines.join('\n')
}
