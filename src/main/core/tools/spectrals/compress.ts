import { randomUUID } from 'node:crypto'
import { rename, rm } from 'node:fs/promises'
import { extname } from 'node:path'
import sharp from 'sharp'

/** Losslessly re-encode generated spectral PNGs before they are displayed or hosted. */
export async function compressSpectralPngs(filePaths: string[], signal?: AbortSignal): Promise<void> {
  for (const filePath of filePaths) {
    throwIfAborted(signal)
    const temporaryPath = temporaryPathFor(filePath)
    try {
      // Sharp strips metadata unless explicitly asked to retain it. `palette`
      // remains false so this only changes PNG encoding, never image pixels.
      await sharp(filePath)
        .png({ compressionLevel: 9, effort: 2, adaptiveFiltering: true, palette: false })
        .toFile(temporaryPath)
      throwIfAborted(signal)
      await rename(temporaryPath, filePath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
}

function temporaryPathFor(filePath: string): string {
  const extension = extname(filePath) || '.png'
  const stem = filePath.slice(0, -extension.length)
  return `${stem}.${randomUUID()}.tmp${extension}`
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return
  const error = new Error('Spectral compression aborted')
  error.name = 'AbortError'
  throw error
}
