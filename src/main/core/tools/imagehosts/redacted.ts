import path from 'node:path'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import { isHTTPSURL, normalizeTrackerHost, trackerHTTPSURL } from '@shared/config/network'
import { imageFileBlob } from './file'
import { ImageHostUploadError, type ImageHostProvider } from './provider'

function uploadUrl(siteUrl: string): string {
  return `${trackerHTTPSURL(siteUrl)}/ajax.php?action=upload_image`
}

export const redactedProvider: ImageHostProvider = {
  id: 'redacted',

  async upload(cfg, filePath) {
    const tracker = cfg.trackers.redacted
    const siteHost = normalizeTrackerHost(tracker.siteUrl)
    if (!siteHost) return null
    const siteUrl = trackerHTTPSURL(siteHost)
    if (!isHTTPSURL(siteUrl)) {
      throw new ImageHostUploadError('RED image host requires a valid tracker host.')
    }
    const apiKey = tracker.apiKey.trim()
    if (!apiKey) {
      throw new ImageHostUploadError('RED image host requires a Redacted API key.')
    }

    const form = new FormData()
    form.append('file', await imageFileBlob(filePath), path.basename(filePath))

    const response = await fetch(uploadUrl(siteUrl), {
      method: 'POST',
      headers: { Authorization: apiKey, 'User-Agent': DEFAULT_USER_AGENT },
      body: form,
      signal: AbortSignal.timeout(60_000)
    })

    let json: {
      status?: string
      response?: { url?: string }
      error?: string
    }
    try {
      json = (await response.json()) as typeof json
    } catch {
      throw new ImageHostUploadError(
        response.ok
          ? 'RED image host returned an invalid response.'
          : `RED image upload failed with HTTP ${response.status}.`
      )
    }

    if (json.status !== 'success') {
      throw new ImageHostUploadError(
        `RED rejected the image: ${json.error?.trim() || 'unknown error'}`
      )
    }
    if (!response.ok) {
      throw new ImageHostUploadError(`RED image upload failed with HTTP ${response.status}.`)
    }

    const url = json.response?.url?.trim()
    if (!url) throw new ImageHostUploadError('RED image host returned no image URL.')
    return url
  }
}
