import path from 'node:path'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import { imageFileBlob } from './file'
import type { ImageHostProvider } from './provider'

const UPLOAD_URL = 'https://catbox.moe/user/api.php'

export const catboxProvider: ImageHostProvider = {
  id: 'catbox',

  healthTarget(cfg) {
    return {
      id: 'catbox',
      name: 'Catbox',
      enabled: cfg.imageHosts.catbox.enabled,
      requiresApiKey: false,
      apiKey: '',
      url: UPLOAD_URL,
      headers: { Referer: 'https://catbox.moe/' }
    }
  },

  async upload(_cfg, filePath) {
    const form = new FormData()
    form.append('reqtype', 'fileupload')
    form.append('fileToUpload', await imageFileBlob(filePath), path.basename(filePath))

    const response = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: { Referer: 'https://catbox.moe/', 'User-Agent': DEFAULT_USER_AGENT },
      body: form,
      signal: AbortSignal.timeout(60_000)
    })
    if (!response.ok) return null
    return (await response.text()).trim() || null
  }
}
