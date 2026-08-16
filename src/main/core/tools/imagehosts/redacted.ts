import path from 'node:path'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import { isHTTPSURL } from '@shared/config/network'
import { normalizeTrackerUrl } from '@main/core/tools/trackers/gazelle'
import { imageFileBlob } from './file'
import { ImageHostUploadError, type ImageHostProvider } from './provider'

function uploadUrl(siteUrl: string): string {
  return `${normalizeTrackerUrl(siteUrl)}/ajax.php?action=upload_image`
}

export const redactedProvider: ImageHostProvider = {
  id: 'redacted',

  healthTarget(cfg) {
    const tracker = cfg.trackers.redacted
    const trackerReady =
      tracker.enabled && tracker.siteUrl.trim() !== '' && tracker.announceUrl.trim() !== ''
    const apiKey = tracker.apiKey.trim()
    const secureSiteUrl = isHTTPSURL(tracker.siteUrl.trim())
    return {
      id: 'redacted',
      name: 'Redacted Image Host',
      enabled: cfg.imageHosts.redacted.enabled,
      requiresApiKey: true,
      apiKey,
      url: uploadUrl(tracker.siteUrl),
      headers: apiKey ? { Authorization: apiKey } : undefined,
      blockedReason: !trackerReady
        ? 'Requires Redacted tracker'
        : secureSiteUrl
          ? undefined
          : 'Redacted tracker site URL must use HTTPS'
    }
  },

  async upload(cfg, filePath) {
    const tracker = cfg.trackers.redacted
    const siteUrl = normalizeTrackerUrl(tracker.siteUrl)
    if (!siteUrl) return null
    if (!isHTTPSURL(siteUrl)) {
      throw new ImageHostUploadError('RED image host requires a tracker HTTPS URL.')
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
