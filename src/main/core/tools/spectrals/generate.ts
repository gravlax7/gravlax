import { mkdir, readdir, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { discoverFLACFiles, type FlacFile } from '@main/core/tools/flacFiles'
import { runCommand } from '@main/core/tools/runCommand'
import { compressSpectralPngs } from './compress'

export interface SpectralSummary {
  trackCount: number
  outputPath: string
}

export interface SpectralProgress {
  completedTracks: number
  totalTracks: number
  currentTrack: string
}

type CommandRunner = (name: string, args: string[], signal?: AbortSignal) => Promise<Buffer>

export interface GenerateSpectralsOptions {
  compress?: boolean
  signal?: AbortSignal
  onProgress?: (progress: SpectralProgress) => void
  onCompress?: () => void
  run?: CommandRunner
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

  options.onProgress?.({
    completedTracks: 0,
    totalTracks: files.length,
    currentTrack: files[0]!.relativePath
  })

  const generatedPaths: string[] = []
  for (let index = 0; index < files.length; index++) {
    const file = files[index]!
    generatedPaths.push(
      ...(await generateFile(options.run ?? runCommand, outputPath, file, index, options.signal))
    )
    const nextTrack = index + 1 < files.length ? files[index + 1]!.relativePath : ''
    options.onProgress?.({
      completedTracks: index + 1,
      totalTracks: files.length,
      currentTrack: nextTrack
    })
  }

  if (options.compress) {
    options.onCompress?.()
    await compressSpectralPngs(generatedPaths, options.signal)
  }

  return { trackCount: files.length, outputPath }
}

async function generateFile(
  run: CommandRunner,
  outputPath: string,
  file: FlacFile,
  index: number,
  signal?: AbortSignal
): Promise<[string, string]> {
  const zoomStart = await zoomStartpoint(run, file.absolutePath, signal)
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

async function zoomStartpoint(run: CommandRunner, path: string, signal?: AbortSignal): Promise<number> {
  const output = await run('sox', ['--i', '-D', path], signal)
  const durationSeconds = Number.parseFloat(output.toString('utf8').trim())
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
