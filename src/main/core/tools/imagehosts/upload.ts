import type { Config } from '@shared/types/config'
import { imageHostProviderById } from './providers'
import { ImageHostUploadError, type CoverImageHostId } from './provider'

export type { CoverImageHostId } from './provider'

export async function uploadImageToHost(
  cfg: Config,
  hostId: CoverImageHostId,
  filePath: string
): Promise<string | null> {
  try {
    return await imageHostProviderById[hostId].upload(cfg, filePath)
  } catch (error) {
    if (error instanceof ImageHostUploadError) throw error
    return null
  }
}

export const uploadCoverImage = uploadImageToHost

/** Concurrency for spectral uploads — the same figure salmon settled on. */
const SPECTRAL_UPLOAD_BATCH = 4

/**
 * Host a batch of spectrals, preserving input order.
 *
 * A `null` entry is a failed upload; callers must treat that as fatal rather
 * than publishing a description with half its images missing.
 */
export async function uploadSpectralImages(
  cfg: Config,
  hostId: CoverImageHostId,
  filePaths: string[],
  signal?: AbortSignal
): Promise<Array<string | null>> {
  const results: Array<string | null> = new Array(filePaths.length).fill(null)
  for (let start = 0; start < filePaths.length; start += SPECTRAL_UPLOAD_BATCH) {
    if (signal?.aborted) throw new Error('Spectral upload aborted')
    const batch = filePaths.slice(start, start + SPECTRAL_UPLOAD_BATCH)
    const uploaded = await Promise.all(
      batch.map((filePath) => uploadImageToHost(cfg, hostId, filePath))
    )
    for (let i = 0; i < uploaded.length; i++) {
      results[start + i] = uploaded[i] ?? null
    }
  }
  return results
}

export function selectCoverImageHost(
  cfg: Config,
  selectedTrackerIds: Array<'redacted' | 'orpheus'>
): CoverImageHostId | null {
  const hosts = selectedTrackerIds
    .map((id) => cfg.trackers[id]?.coverImageHost?.trim() ?? '')
    .filter((h): h is CoverImageHostId => h === 'thesungod' || h === 'imgbb' || h === 'redacted')

  if (hosts.length === 0) return null
  if (selectedTrackerIds.length > 1) {
    return hosts.find((host) => host !== 'redacted') ?? null
  }
  return hosts[0] ?? null
}
