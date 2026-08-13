import { randomUUID } from 'node:crypto'
import { rename, rm, stat } from 'node:fs/promises'
import { extname } from 'node:path'
import sharp from 'sharp'
import { processFiles } from '@main/core/tools/transcode/processFiles'

export type SpectralPngEncoder = (sourcePath: string, temporaryPath: string) => Promise<void>

export interface CompressSpectralPngsOptions {
  signal?: AbortSignal
  concurrency?: number
  encode?: SpectralPngEncoder
}

export interface SpectralCompressionResult {
  checkedPaths: string[]
  optimizedPaths: string[]
  failures: Array<{ filePath: string; error: string }>
}

/** Losslessly re-encode chosen spectral PNGs, keeping only smaller results. */
export async function compressSpectralPngs(
  filePaths: string[],
  options: CompressSpectralPngsOptions = {}
): Promise<SpectralCompressionResult> {
  const optimized = new Array<boolean>(filePaths.length).fill(false)
  const failures = new Array<{ filePath: string; error: string } | undefined>(filePaths.length)
  const encode = options.encode ?? encodePng

  await processFiles(filePaths, options.concurrency ?? 3, async (filePath, index) => {
    throwIfAborted(options.signal)
    const temporaryPath = temporaryPathFor(filePath)
    try {
      await encode(filePath, temporaryPath)
      throwIfAborted(options.signal)
      const [sourceInfo, encodedInfo] = await Promise.all([stat(filePath), stat(temporaryPath)])
      if (encodedInfo.size < sourceInfo.size) {
        await rename(temporaryPath, filePath)
        optimized[index] = true
      }
    } catch (err) {
      if (isAbortError(err) || options.signal?.aborted) throw abortError()
      failures[index] = { filePath, error: String(err) }
    } finally {
      await rm(temporaryPath, { force: true })
    }
  })

  return {
    checkedPaths: [...filePaths],
    optimizedPaths: filePaths.filter((_path, index) => optimized[index]),
    failures: failures.filter(
      (failure): failure is { filePath: string; error: string } => failure !== undefined
    )
  }
}

async function encodePng(sourcePath: string, temporaryPath: string): Promise<void> {
  // Sharp strips metadata unless explicitly asked to retain it. `palette`
  // remains false so this only changes PNG encoding, never image pixels.
  await sharp(sourcePath)
    .png({ compressionLevel: 9, effort: 2, adaptiveFiltering: true, palette: false })
    .toFile(temporaryPath)
}

function temporaryPathFor(filePath: string): string {
  const extension = extname(filePath) || '.png'
  const stem = filePath.slice(0, -extension.length)
  return `${stem}.${randomUUID()}.tmp${extension}`
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  throw abortError()
}

function isAbortError(err: unknown): boolean {
  return (err as Error | undefined)?.name === 'AbortError'
}

function abortError(): Error {
  const error = new Error('Spectral compression aborted')
  error.name = 'AbortError'
  return error
}
