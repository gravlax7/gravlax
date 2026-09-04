import type { UploadTrackerId } from '../trackers'
import type { ThemePreference } from '../theme'

export type { ThemePreference } from '../theme'

export const CONFIG_SECTION_IDS = [
  'appearance',
  'directories',
  'tools',
  'trackers',
  'metadataProviders',
  'imageHosts',
  'torrentClient',
  'transfer',
  'naming',
  'spectral',
  'cleanup',
  'workflow'
] as const satisfies readonly (keyof Config)[]

export type SectionID = (typeof CONFIG_SECTION_IDS)[number]

export const COVER_IMAGE_HOST_IDS = [
  'thesungod',
  'imgbb',
  'catbox',
  'redacted'
] as const satisfies readonly (keyof ImageHostsConfig)[]

export type CoverImageHostId = (typeof COVER_IMAGE_HOST_IDS)[number]

export type FieldType =
  | 'bool'
  | 'string'
  | 'number'
  | 'enum'
  | 'path'
  | 'file'
  | 'url'
  | 'host'
  | 'separator'

export interface Config {
  appearance: AppearanceConfig
  directories: DirectoriesConfig
  tools: ToolsConfig
  trackers: TrackersConfig
  metadataProviders: MetadataProvidersConfig
  imageHosts: ImageHostsConfig
  torrentClient: TorrentClientConfig
  transfer: TransferConfig
  naming: NamingConfig
  spectral: SpectralConfig
  cleanup: CleanupConfig
  workflow: WorkflowConfig
}

export interface AppearanceConfig {
  theme: ThemePreference
}

export interface DirectoriesConfig {
  source: string
  torrents: string
  /** Where releases are placed for a local torrent client when there is no seedbox. */
  seeding: string
}

export interface ToolsConfig {
  sox: string
  flac: string
  metaflac: string
  lame: string
}

export type TrackersConfig = Record<UploadTrackerId, TrackerConfig>

export interface TrackerConfig {
  enabled: boolean
  siteUrl: string
  announceUrl: string
  apiKey: string
  sessionCookie: string
  coverImageHost: string
}

export interface MetadataProvidersConfig {
  musicBrainz: MetadataProviderConfig
  deezer: MetadataProviderConfig
  bandcamp: MetadataProviderConfig
  discogs: DiscogsMetadataProviderConfig
  requestTimeoutSeconds: number
}

export interface MetadataProviderConfig {
  enabled: boolean
}

export interface DiscogsMetadataProviderConfig extends MetadataProviderConfig {
  token: string
}

export interface ImageHostsConfig {
  thesungod: ImageHostAPIKeyConfig
  imgbb: ImageHostAPIKeyConfig
  catbox: ImageHostToggleConfig
  redacted: ImageHostToggleConfig
}

export interface ImageHostAPIKeyConfig {
  enabled: boolean
  apiKey: string
}

export interface ImageHostToggleConfig {
  enabled: boolean
}

export interface TorrentClientConfig {
  enabled: boolean
  url: string
  /** Allow plain HTTP when the WebUI URL uses a private LAN IP address. */
  allowInsecureHTTP: boolean
  useApiKey: boolean
  apiKey: string
  username: string
  password: string
  category: string
  /**
   * When true qBittorrent decides the location from the category and `savePath`
   * is unused. When false gravlax pins the location explicitly.
   */
  useAutoTMM: boolean
  /**
   * Where qBittorrent looks for the release data. Empty falls back to the
   * seedbox `remotePath`, which is correct whenever the client sees the same
   * filesystem the upload landed on.
   */
  savePath: string
  startPaused: boolean
}

export interface TransferConfig {
  enabled: boolean
  host: string
  port: number
  username: string
  password: string
  privateKeyPath: string
  remotePath: string
}

export interface NamingConfig {
  albumDescriptionTemplateId: string
  releaseFolderTemplate: string
  trackFileTemplate: string
  multiDiscFolderTemplate: string
}

export interface SpectralConfig {
  imageHost: string
  defaultSpectralIds: string
  defaultSpectralIdsForLossyMasters: string
}

export interface CleanupConfig {
  archiveDirectory: string
  deleteOriginalFolder: boolean
  deleteTemporaryFiles: boolean
  deleteSpectralsAfterUpload: boolean
}

export interface WorkflowConfig {
  confirmBeforeWrites: boolean
  useUpcAsCatNo: boolean
  autoRepairFlacIntegrity: boolean
  keepExistingTagsByDefault: boolean
}

export interface ValidationIssue {
  section: SectionID
  field: string
  message: string
}

export interface FieldMetadata {
  name: string
  label: string
  description?: string
  placeholder?: string
  type: FieldType
  sensitive?: boolean
  options?: string[]
}

export interface SectionMetadata {
  id: SectionID
  title: string
  description?: string
  fields: FieldMetadata[]
}

export type NotifyLevel = 'info' | 'warning' | 'error' | 'success'

export interface NotifyPayload {
  level: NotifyLevel
  message: string
  durationMs?: number
}
