import type { Config } from '@shared/types/config'

export type CoverImageHostId = 'thesungod' | 'imgbb' | 'catbox' | 'redacted'

export class ImageHostUploadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageHostUploadError'
  }
}

export interface ImageHostHealthTarget {
  id: CoverImageHostId
  name: string
  enabled: boolean
  requiresApiKey: boolean
  apiKey: string
  url: string
  headers?: Record<string, string>
}

export interface ImageHostProvider {
  id: CoverImageHostId
  healthTarget?: (cfg: Config) => ImageHostHealthTarget
  /** Returns a message when the configured API key is rejected. */
  validateApiKey?: (cfg: Config) => Promise<string | null>
  upload: (cfg: Config, filePath: string) => Promise<string | null>
}
