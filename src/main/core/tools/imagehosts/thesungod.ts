import path from 'node:path'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import { imageFileBlob } from './file'
import type { ImageHostProvider } from './provider'

const UPLOAD_URL = 'https://thesungod.xyz/api/image/upload'

export const thesungodProvider: ImageHostProvider = {
  id: 'thesungod',

  healthTarget(cfg) {
    return {
      id: 'thesungod',
      name: 'Ra (thesungod)',
      enabled: cfg.imageHosts.thesungod.enabled,
      requiresApiKey: true,
      apiKey: cfg.imageHosts.thesungod.apiKey,
      url: UPLOAD_URL
    }
  },

  async validateApiKey(cfg) {
    const form = new FormData()
    form.append('api_key', cfg.imageHosts.thesungod.apiKey)

    try {
      // Deliberately omit an image. Ra checks the key before it rejects the
      // incomplete upload, so this verifies credentials without creating a file.
      const response = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { 'User-Agent': DEFAULT_USER_AGENT },
        body: form,
        signal: AbortSignal.timeout(3000)
      })
      const body = await response.text().catch(() => '')
      if (
        response.status === 401 ||
        response.status === 403 ||
        /api[ _-]?key|unauthori[sz]ed|invalid token/i.test(body)
      ) {
        return 'Invalid API key'
      }
      return null
    } catch {
      return 'Could not validate API key'
    }
  },

  async upload(cfg, filePath) {
    const apiKey = cfg.imageHosts.thesungod.apiKey
    if (!apiKey) return null

    const form = new FormData()
    form.append('api_key', apiKey)
    form.append('image', await imageFileBlob(filePath), path.basename(filePath))

    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { 'User-Agent': DEFAULT_USER_AGENT },
      body: form,
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) return null
    const json = (await response.json()) as { links?: string[] }
    const link = json.links?.[0]?.trim()
    return link || null
  }
}
