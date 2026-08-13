import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { discoverFLACFiles, type FlacFile } from '@main/core/tools/flacFiles'
import { automaticToolResolver, type ToolId, type ToolResolver } from '@main/core/tools/binaries'
import { readFLACStreamInfo } from '@main/core/tools/diagnostics/mqa'
import { runCommand } from '@main/core/tools/runCommand'
import { processFiles } from '@main/core/tools/transcode/processFiles'

export interface SpectralSummary {
  trackCount: number
  outputPath: string
}

export interface SpectralProgress {
  completedTracks: number
  totalTracks: number
  currentTrack: string
}

type CommandRunner = (name: ToolId, args: string[], signal?: AbortSignal) => Promise<Buffer>
type DurationReader = (path: string) => Promise<number>

export interface GenerateSpectralsOptions {
  concurrency?: number
  signal?: AbortSignal
  onProgress?: (progress: SpectralProgress) => void
  readDuration?: DurationReader
  run?: CommandRunner
  tools?: ToolResolver
}

export async function generateSpectrals(
  workspacePath: string,
  options: GenerateSpectralsOptions = {}
): Promise<SpectralSummary> {
  if (!workspacePath) {
    throw new Error('workspace path is required')
  }

  const outputPath = join(dirname(workspacePath), 'Spectrals')
  await rm(outputPath, { recursive: true, force: true })
  await mkdir(outputPath, { recursive: true, mode: 0o755 })

  const files = await discoverFLACFiles(workspacePath)
  if (files.length === 0) {
    return { trackCount: 0, outputPath }
  }

  const tools = options.tools ?? automaticToolResolver
  const run = options.run ?? ((name: ToolId, args: string[], signal?: AbortSignal) =>
    runCommand(name, args, signal, undefined, tools))
  const readDuration = options.readDuration ?? (async (path: string) =>
    (await readFLACStreamInfo(path)).durationSeconds)

  await processFiles(
    files,
    options.concurrency ?? 3,
    async (file, index) => {
      options.signal?.throwIfAborted()
      await generateFile(
        run,
        readDuration,
        outputPath,
        file,
        index,
        options.signal
      )
    },
    (progress) => {
      options.onProgress?.({
        completedTracks: progress.completed,
        totalTracks: progress.total,
        currentTrack: progress.currentLabel
      })
    },
    (file) => file.relativePath
  )

  return { trackCount: files.length, outputPath }
}

async function generateFile(
  run: CommandRunner,
  readDuration: DurationReader,
  outputPath: string,
  file: FlacFile,
  index: number,
  signal?: AbortSignal
): Promise<[string, string]> {
  const zoomStart = await zoomStartpoint(readDuration, file.absolutePath)
  const fullOutputPath = join(outputPath, `${String(index + 1).padStart(2, '0')} Full.png`)
  const zoomOutputPath = join(outputPath, `${String(index + 1).padStart(2, '0')} Zoom.png`)
  const args = [
    '--multi-threaded',
    file.absolutePath,
    '--buffer',
    '128000',
    '-n',
    'remix',
    '1',
    'spectrogram',
    '-x',
    '2000',
    '-y',
    '513',
    '-z',
    '120',
    '-w',
    'Kaiser',
    '-o',
    fullOutputPath,
    'remix',
    '1',
    'spectrogram',
    '-x',
    '500',
    '-y',
    '1025',
    '-z',
    '120',
    '-w',
    'Kaiser',
    '-S',
    String(zoomStart),
    '-d',
    '0:02',
    '-o',
    zoomOutputPath
  ]
  try {
    await run('sox', args, signal)
    return [fullOutputPath, zoomOutputPath]
  } catch (err) {
    throw new Error(`generate spectrals for "${file.relativePath}": ${String(err)}`)
  }
}

async function zoomStartpoint(readDuration: DurationReader, path: string): Promise<number> {
  const durationSeconds = await readDuration(path)
  if (Number.isNaN(durationSeconds)) {
    throw new Error(`parse audio duration for "${path}"`)
  }
  if (durationSeconds > 5) {
    return Math.floor(durationSeconds / 2)
  }
  return 0
}

export async function listSpectralPairs(
  workspacePath: string
): Promise<Array<{ full: string; zoom: string; index: number; filename: string }>> {
  const files = await discoverFLACFiles(workspacePath)
  if (files.length === 0) return []

  const outputPath = join(dirname(workspacePath), 'Spectrals')
  let entries: Set<string>
  try {
    entries = new Set(await readdir(outputPath))
  } catch {
    return []
  }

  const pairs: Array<{ full: string; zoom: string; index: number; filename: string }> = []
  for (let i = 0; i < files.length; i++) {
    const id = String(i + 1).padStart(2, '0')
    const fullName = `${id} Full.png`
    const zoomName = `${id} Zoom.png`
    if (!entries.has(fullName) || !entries.has(zoomName)) continue
    pairs.push({
      index: i + 1,
      full: join(outputPath, fullName),
      zoom: join(outputPath, zoomName),
      filename: files[i]!.relativePath
    })
  }
  return pairs
}
