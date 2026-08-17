export type SectionID =
  | 'appearance'
  | 'directories'
  | 'tools'
  | 'trackers'
  | 'metadataProviders'
  | 'imageHosts'
  | 'torrentClient'
  | 'transfer'
  | 'naming'
  | 'spectral'
  | 'cleanup'
  | 'workflow'

export type ThemePreference =
  | 'system'
  | 'dark'
  | 'midnight'
  | 'fjord'
  | 'ember'
  | 'phosphor'
  | 'light'
  | 'inkwell'

export type FieldType = 'bool' | 'string' | 'number' | 'enum' | 'path' | 'file' | 'url' | 'separator'

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
  mp3val: string
  lame: string
}

export interface TrackersConfig {
  redacted: TrackerConfig
  orpheus: TrackerConfig
}

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
  requestTimeoutSeconds: number
}

export interface MetadataProviderConfig {
  enabled: boolean
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
