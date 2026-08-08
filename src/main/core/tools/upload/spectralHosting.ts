import type { Config } from '@shared/types/config'
import { clampSpectralIds } from '@shared/upload/spectralIds'
import { supportsSpectralUpload } from '@shared/config/imageHosts'
import {
  uploadSpectralImages,
  type CoverImageHostId
} from '@main/core/tools/imagehosts/upload'
import { listSpectralPairs } from '@main/core/tools/spectrals/generate'
import { makeSpectralBbcode } from './descriptions'

export interface HostSpectralsResult {
  bbcode: string
  hostedCount: number
  /** Set when the caller should stop rather than upload a half-illustrated description. */
  error?: string
}

/**
 * Host the spectrals the user selected and render them as BBCode.
 *
 * Selecting none is a valid answer, not a failure: the description simply loses
 * its spectral block. A host that is configured but drops an image is a
 * failure, because a description missing half its spectrals reads as an attempt
 * to hide something.
 */
export async function hostSpectralsForUpload(
  cfg: Config,
  workspacePath: string,
  selectedIds: number[],
  signal?: AbortSignal
): Promise<HostSpectralsResult> {
  const pairs = await listSpectralPairs(workspacePath)
  if (pairs.length === 0) return { bbcode: '', hostedCount: 0 }

  const ids = clampSpectralIds(selectedIds, pairs.length)
  if (ids.length === 0) return { bbcode: '', hostedCount: 0 }

  const host = cfg.spectral.imageHost.trim()
  if (!host || !supportsSpectralUpload(host)) {
    return {
      bbcode: '',
      hostedCount: 0,
      error: 'No image host is configured for spectrals (Settings → Spectrals → Image host).'
    }
  }

  const selected = ids
    .map((id) => pairs.find((pair) => pair.index === id))
    .filter((pair): pair is (typeof pairs)[number] => pair !== undefined)

  // Full and zoom interleaved so one batch covers whole tracks.
  const files = selected.flatMap((pair) => [pair.full, pair.zoom])
  const urls = await uploadSpectralImages(cfg, host as CoverImageHostId, files, signal)

  const entries: Array<{ filename: string; fullUrl: string; zoomUrl: string }> = []
  for (let i = 0; i < selected.length; i++) {
    const fullUrl = urls[i * 2]
    const zoomUrl = urls[i * 2 + 1]
    if (!fullUrl || !zoomUrl) {
      return {
        bbcode: '',
        hostedCount: 0,
        error: `Failed to upload spectrals for "${selected[i]!.filename}" to ${host}.`
      }
    }
    entries.push({ filename: selected[i]!.filename, fullUrl, zoomUrl })
  }

  return { bbcode: makeSpectralBbcode(entries), hostedCount: entries.length }
}
