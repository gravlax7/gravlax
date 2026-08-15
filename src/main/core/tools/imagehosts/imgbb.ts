import path from 'node:path'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import { imageFileBlob } from './file'
import type { ImageHostProvider } from './provider'

const UPLOAD_URL = 'https://api.imgbb.com/1/upload'

export const imgbbProvider: ImageHostProvider = {
  id: 'imgbb',

  healthTarget(cfg) {
    return {
      id: 'imgbb',
      name: 'imgbb',
      enabled: cfg.imageHosts.imgbb.enabled,
      requiresApiKey: true,
      apiKey: cfg.imageHosts.imgbb.apiKey,
      url: UPLOAD_URL
    }
  },

  async upload(cfg, filePath) {
    const apiKey = cfg.imageHosts.imgbb.apiKey
    if (!apiKey) return null

    const form = new FormData()
    form.append('key', apiKey)
    form.append('image', await imageFileBlob(filePath), path.basename(filePath))

    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Referer: 'https://imgbb.com/', 'User-Agent': DEFAULT_USER_AGENT },
      body: form,
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) return null
    const json = (await response.json()) as { data?: { url?: string } }
    return json.data?.url?.trim() || null
  }
}
