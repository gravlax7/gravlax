export const FIELD_ARTISTS = 'artists'
export const FIELD_ALBUM_ARTIST = 'albumArtist'
export const FIELD_TITLE = 'title'
export const FIELD_GROUP_YEAR = 'groupYear'
export const FIELD_YEAR = 'year'
export const FIELD_EDITION_TITLE = 'editionTitle'
export const FIELD_LABEL = 'label'
export const FIELD_CAT_NO = 'catNo'
export const FIELD_UPC = 'upc'
export const FIELD_GENRES = 'genres'
export const FIELD_RELEASE_TYPE = 'releaseType'
export const FIELD_COMMENT = 'comment'
export const FIELD_URLS = 'urls'
export const FIELD_TRACK_COUNT = 'trackCount'
export const FIELD_DISC_NUMBER = 'discNumber'
export const FIELD_TRACK_NUMBER = 'trackNumber'

export const DISPLAY_EMPTY = '(empty)'
export const DISPLAY_MIXED = 'mixed'
export const DEFAULT_ARTIST_ROLE = 'main'

export const FIELD_ORDER = [
  FIELD_TRACK_COUNT,
  FIELD_ARTISTS,
  FIELD_ALBUM_ARTIST,
  FIELD_TITLE,
  FIELD_GROUP_YEAR,
  FIELD_YEAR,
  FIELD_EDITION_TITLE,
  FIELD_LABEL,
  FIELD_CAT_NO,
  FIELD_UPC,
  FIELD_GENRES,
  FIELD_RELEASE_TYPE,
  FIELD_COMMENT,
  FIELD_URLS
] as const

export const TRACK_FIELD_ORDER = [
  FIELD_DISC_NUMBER,
  FIELD_TRACK_NUMBER,
  FIELD_TITLE,
  FIELD_ARTISTS
] as const

export const ARTIST_ROLE_PRESETS = [
  DEFAULT_ARTIST_ROLE,
  'guest',
  'composer',
  'conductor',
  'dj/compiler',
  'remixer',
  'producer',
  'arranger'
] as const

export interface Artist {
  name?: string
  role?: string
}

export interface Track {
  discNumber?: string
  trackNumber?: string
  title?: string
  artists?: Artist[]
}

export interface Release {
  artists?: Artist[]
  albumArtist?: string
  title?: string
  groupYear?: string
  year?: string
  editionTitle?: string
  label?: string
  catNo?: string
  upc?: string
  genres?: string[]
  releaseType?: string
  comment?: string
  cover?: string
  urls?: string[]
  trackCount?: number
  tracks?: Track[]
  mixed?: Record<string, boolean>
}

export type StepID =
  | 'files-check'
  | 'spectrals'
  | 'metadata'
  | 'tags'
  | 'transcode'
  | 'upload'
  | 'seed'

export type SourceMedia = 'WEB' | 'CD'

export interface Step {
  id: StepID
  title: string
  body: string
}

export interface Draft {
  sourcePath: string
  workspacePath: string
  sourceMedia: SourceMedia | ''
  lossyMaster: boolean
  lossyComment: string
  /** One-based track numbers whose spectrals go in the release description. */
  spectralIds: number[]
  /** False once the user has picked by hand, so settings stop overwriting them. */
  spectralIdsAuto: boolean
}

export type BackgroundTaskID =
  | 'files-check'
  | 'spectrals'
  | 'metadata'
  | 'transcode'

export type BackgroundTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface BackgroundTask {
  id: BackgroundTaskID
  step: StepID
  title: string
  status: BackgroundTaskStatus
  detail: string
  progressCurrent: number
  progressTotal: number
  progressLabel: string
}

export interface BackgroundWork {
  sourcePath: string
  sourceMedia: SourceMedia | ''
  tasks: BackgroundTask[]
}

export interface TaskSnapshot {
  status: BackgroundTaskStatus
  detail?: string
  progressCurrent?: number
  progressTotal?: number
  progressLabel?: string
}

export type MetadataProviderStatus =
  | 'queued'
  | 'running'
  | 'matched'
  | 'empty'
  | 'failed'
  | 'inactive'

export const METADATA_PROVIDER_MANUAL = 'manual'

export interface MetadataBaseline {
  artists?: string[]
  title?: string
  year?: number
  label?: string
  catNo?: string
  upc?: string
  trackCount?: number
  queryStrings?: string[]
}

export interface MetadataSearchResult {
  provider?: string
  releaseId?: string
  url?: string
  display?: string
  artist?: string
  album?: string
  year?: number
  trackCount?: number
  source?: string
}

export interface MetadataProviderResults {
  provider?: string
  status?: MetadataProviderStatus
  error?: string
  results?: MetadataSearchResult[]
}

export interface MetadataSelection {
  provider?: string
  releaseId?: string
  url?: string
}

export type MetadataUrlResolution =
  | { ok: true; selection: MetadataSelection }
  | { ok: false; error: string }

export interface MetadataSearchSnapshot {
  baseline?: MetadataBaseline
  providers?: MetadataProviderResults[]
  selected?: MetadataSelection | null
}

export type TagsStatus = 'idle' | 'loading' | 'ready' | 'failed'

export interface TagsSnapshot {
  current?: Release
  currentStatus?: TagsStatus
  currentError?: string
  selected?: Release
  proposed?: Release
  proposedDirty?: boolean
  releaseStatus?: TagsStatus
  releaseError?: string
  cursor?: number
}

export type FilesApplyPhase = 'idle' | 'applying' | 'applied' | 'restoring' | 'failed'

export interface OriginalFileSnapshot {
  /** Stable id which does not change when the path does. */
  id: string
  relativePath: string
  /** Original comments for keys Gravlax owns, kept byte-for-byte as strings. */
  managedComments?: string[]
  /** Paths below .gravlax-original-metadata, in original block order. */
  pictureBackups?: Array<{ blockNumber: number; relativePath: string }>
  /** Large legacy COVERART values also stay out of the JSON snapshot. */
  legacyCoverBackups?: Array<{ key: 'COVERART' | 'COVERARTMIME'; relativePath: string }>
}

export interface FilesOriginalSnapshot {
  captured: boolean
  coverCaptured: boolean
  /** Embedded PICTURE blocks and legacy COVERART values found in the source files. */
  embeddedCoverArtCount?: number
  folderName: string
  files: OriginalFileSnapshot[]
}

export interface FileNameState {
  id: string
  currentPath: string
  filenameOverride?: string
}

export interface FilesApplySnapshot {
  phase: FilesApplyPhase
  progressCurrent?: number
  progressTotal?: number
  progressLabel?: string
  onDiskModified: boolean
  stripEmbeddedCoverArt: boolean
  renameReleaseFolder: boolean
  currentFolderName: string
  folderNameOverride?: string
  files: FileNameState[]
  /** Migration marker: an old session already past this step keeps its paths. */
  grandfathered?: boolean
  appliedHash?: string
  changedFileCount?: number
  strippedPictureCount?: number
  error?: string
}

export interface FilesSnapshot {
  original: FilesOriginalSnapshot
  apply: FilesApplySnapshot
}

export type Bitrate = 'V0' | '320'
export type BitDepth = 16 | 24
export type TranscodeEncoding = 'Lossless' | '24bit Lossless'
export type TranscodeOptionAction = 'downconvert' | 'transcode'
export type TranscodeJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

export interface TranscodeOption {
  id: string
  name: string
  action: TranscodeOptionAction
  bitrate?: Bitrate
  targetBitDepth?: BitDepth
  targetSampleRate?: number
  outputFolderName: string
}

export interface TranscodeBlocker {
  kind: 'lossy' | 'multichannel' | 'untagged' | 'empty' | 'invalid-rate'
  message: string
}

export interface TranscodeInspection {
  encoding: TranscodeEncoding
  sampleRate: number
  trackCount: number
  hybrid: boolean
  options: TranscodeOption[]
  blockers: TranscodeBlocker[]
}

export interface TranscodeJobResult {
  optionId: string
  status: TranscodeJobStatus
  outputPath?: string
  error?: string
}

export type TranscodePhase = 'idle' | 'inspecting' | 'ready' | 'running' | 'done' | 'failed'

export interface TranscodeSnapshot {
  phase?: TranscodePhase
  inspection?: TranscodeInspection
  selectedOptionIds?: string[]
  essentialOnly?: boolean
  jobs?: TranscodeJobResult[]
  error?: string
}

export type FilesCheckStatus = 'idle' | 'running' | 'ok' | 'failed'

export type IntegrityStatus = 'idle' | 'passed' | 'failed'

export interface IntegrityIssue {
  relativePath: string
  message: string
}

export interface IntegritySummary {
  status: IntegrityStatus
  checkedCount: number
  failures: IntegrityIssue[]
  repairedPaths: string[]
  repairErrors: IntegrityIssue[]
  error?: string
}

export interface MQASummary {
  checkedCount: number
  mqaPaths: string[]
  errors: Array<{ relativePath: string; message: string }>
}

export interface UpconvertCheckResult {
  relativePath: string
  bitDepth: number
  wastedBits: number
  isUpconverted: boolean
}

export interface UpconvertSummary {
  checkedCount: number
  results: UpconvertCheckResult[]
  errors: Array<{ relativePath: string; message: string }>
}

export interface LogCheck {
  relativePath: string
  trackerId: string
  trackerName: string
  score?: number
  checksum?: string
  issues: string[]
  error?: string
}

export interface LogcheckerSummary {
  logFiles: string[]
  checks: LogCheck[]
  /** Set when logchecker did not run at all — not a CD, no logs, no trackers. */
  skippedReason?: string
}

export interface FilesCheckSnapshot {
  status: FilesCheckStatus
  integrity: IntegritySummary
  mqa: MQASummary
  upconvert: UpconvertSummary
  logs: LogcheckerSummary
  /** Set only when the check itself broke, as opposed to finding problems. */
  error?: string
}

export type UploadTrackerId = 'redacted' | 'orpheus'

export type UploadPhase = 'idle' | 'ready' | 'submitting' | 'done' | 'failed'

export type SeedPhase = 'idle' | 'running' | 'done' | 'failed'

/** `copy` is the local-seeding-folder counterpart of `transfer` (SFTP). */
export type SeedTaskKind = 'transfer' | 'copy' | 'inject'

export type SeedTaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface SeedTask {
  id: string
  kind: SeedTaskKind
  label: string
  status: SeedTaskStatus
  detail?: string
  /** Inject rows only — there is one per tracker per format. */
  trackerId?: UploadTrackerId
  bytesTransferred?: number
  bytesTotal?: number
  /** Smoothed, computed in main: the renderer cannot diff debounced pushes. */
  bytesPerSecond?: number
  filesTransferred?: number
  filesTotal?: number
  /** Copy rows only: a hardlinked folder finishes instantly and has no rate. */
  hardlinked?: boolean
}

export interface SeedSnapshot {
  phase: SeedPhase
  tasks: SeedTask[]
  error?: string
}

export interface SeedTorrentInput {
  trackerId: UploadTrackerId
  torrentPath: string
  infoHash: string
}

export interface SeedFormatInput {
  id: string
  label: string
  folderPath: string
  torrents: SeedTorrentInput[]
}

export interface UploadArtist {
  name: string
  importance: number
}

export interface UploadFormatPayload {
  id: string
  label: string
  folderPath: string
  sizeBytes?: number
  format: string
  bitrate: string
  otherBitrate: string
  vbr: boolean
  releaseDesc: string
  logfileNames: string[]
}

export type TrackerGroupSearchStatus = 'idle' | 'running' | 'done' | 'failed'

export interface TrackerGroupSuggestion {
  trackerId: UploadTrackerId
  groupId: number
  artist: string
  groupName: string
  year?: number
  releaseType?: string
  tags: string[]
  url: string
}

export interface TrackerGroupTorrentSummary {
  media?: string
  format?: string
  encoding?: string
  remasterYear?: number
  remasterTitle?: string
  remasterRecordLabel?: string
  remasterCatalogueNumber?: string
  fileCount?: number
  size?: number
}

export interface TrackerGroupDetail {
  trackerId: UploadTrackerId
  groupId: number
  artist: string
  groupName: string
  year?: number
  releaseType?: string
  url: string
  torrents: TrackerGroupTorrentSummary[]
}

export interface TrackerGroupSearchSnapshot {
  status: TrackerGroupSearchStatus
  queryStrings: string[]
  trackerIds: UploadTrackerId[]
  fingerprint?: string
  results: TrackerGroupSuggestion[]
  error?: string
  searchedAt?: number
}

export type UploadSubmissionStatus = 'pending' | 'running' | 'done' | 'failed'

/** One tracker upload of one format. Persisted, so a retry can skip what landed. */
export interface UploadSubmission {
  id: string
  trackerId: UploadTrackerId
  formatId: string
  label: string
  status: UploadSubmissionStatus
  torrentPath?: string
  infoHash?: string
  torrentId?: number
  groupId?: number
  url?: string
  lossyReport?: 'not-needed' | 'done' | 'failed'
  error?: string
}

export type TorrentExportResult =
  | { ok: true; paths: string[] }
  | { ok: false; canceled: true }
  | { ok: false; error: string }

export interface UploadSnapshot {
  phase?: UploadPhase
  selectedTrackerIds?: UploadTrackerId[]
  artists?: UploadArtist[]
  title?: string
  year?: number
  releaseType?: string
  /** Use Orpheus' tracker-only Split type while other trackers keep releaseType. */
  orpheusSplit?: boolean
  unknown?: boolean
  remasterYear?: number
  remasterTitle?: string
  remasterRecordLabel?: string
  remasterCatalogueNumber?: string
  scene?: boolean
  media?: string
  tags?: string
  image?: string
  coverPath?: string
  albumDesc?: string
  groupIds?: Partial<Record<UploadTrackerId, number | null>>
  formats?: UploadFormatPayload[]
  groupSearch?: TrackerGroupSearchSnapshot
  submissions?: UploadSubmission[]
  /** Hosted spectrals, substituted into the source format's release description. */
  spectralBbcode?: string
  seededFrom?: string
  error?: string
}

export interface UploadFlowSnapshot {
  sourcePath: string
  /** `source` is accepted for snapshots written before the start menu existed. */
  currentStepID: StepID | 'source'
  sourceMedia?: SourceMedia
  lossyMaster?: boolean
  lossyComment?: string
  spectralIds?: number[]
  spectralIdsAuto?: boolean
  tasks?: Partial<Record<BackgroundTaskID, TaskSnapshot>>
  metadata?: MetadataSearchSnapshot
  tags?: TagsSnapshot
  files?: FilesSnapshot
  transcode?: TranscodeSnapshot
  filesCheck?: FilesCheckSnapshot
  upload?: UploadSnapshot
  seed?: SeedSnapshot
}

export interface UploadStartNewEntry {
  kind: 'new'
  name: string
  sourcePath: string
  updatedAt: number
}

export interface UploadStartResumeEntry {
  kind: 'resume'
  name: string
  sourcePath: string
  workspacePath: string
  currentStepID: StepID
  updatedAt: number
  sourceExists: boolean
}

export interface UploadedSubmissionSummary {
  trackerId: UploadTrackerId
  label: string
  url?: string
  torrentId?: number
  groupId?: number
}

export interface UploadedReleaseRecord {
  kind: 'uploaded'
  name: string
  sourcePath: string
  completedAt: number
  sourceExists: boolean
  artists: string[]
  title?: string
  year?: number
  submissions: UploadedSubmissionSummary[]
}

export interface UploadStartEntries {
  newEntries: UploadStartNewEntry[]
  resumeEntries: UploadStartResumeEntry[]
  uploadedEntries: UploadedReleaseRecord[]
  sourceError: string
}

export interface UploadFlowStateJSON {
  currentStep: number
  draft: Draft
  background: BackgroundWork
  metadata: MetadataSearchSnapshot
  tags: TagsSnapshot
  files: FilesSnapshot
  transcode: TranscodeSnapshot
  filesCheck: FilesCheckSnapshot
  upload: UploadSnapshot
  seed: SeedSnapshot
}

export type HealthStatus =
  | 'available'
  | 'failing'
  | 'missing'
  | 'disabled'
  | 'checking'
  | 'not-implemented'

export interface HealthRow {
  id: string
  name: string
  group?: string
  status: HealthStatus
  detail?: string
  installURL?: string
  installInstructions?: string
}

export interface HealthResult {
  runId: number
  overview: string
  rows: HealthRow[]
}
