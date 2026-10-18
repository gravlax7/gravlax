import path from 'node:path'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import { imageFileBlob } from './file'
import type { ImageHostProvider } from './provider'

const UPLOAD_URL = 'https://ptscreens.com/api/1/upload'

export const ptscreensProvider: ImageHostProvider = {
  id: 'ptscreens',

  healthTarget(cfg) {
    return {
      id: 'ptscreens',
      name: 'PTScreens',
      enabled: cfg.imageHosts.ptscreens.enabled,
      requiresApiKey: true,
      apiKey: cfg.imageHosts.ptscreens.apiKey,
      url: UPLOAD_URL
    }
  },

  async upload(cfg, filePath) {
    const apiKey = cfg.imageHosts.ptscreens.apiKey
    if (!apiKey) return null

    const form = new FormData()
    form.append('source', await imageFileBlob(filePath), path.basename(filePath))
    form.append('format', 'json')

    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { 'X-API-Key': apiKey, 'User-Agent': DEFAULT_USER_AGENT },
      body: form,
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) return null
    const json = (await response.json()) as { image?: { url?: string } }
    return json.image?.url?.trim() || null
  }
}
