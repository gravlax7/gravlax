import type { Config, SectionID } from '@shared/types/config'
import type { RcloneRemote } from '@shared/config/rcloneConf'
import { sanitizeCoverImageHosts } from '@shared/config/imageHosts'
import { canEnableRedactedImageHost } from '@shared/config/trackers'
import { sections } from '@shared/config/sections'
import { validateReleaseFolderTemplate, validateTrackFileTemplate } from '@shared/upload/naming'

/**
 * Maps a smoked-salmon config.toml onto Gravlax settings. Pure: the caller
 * reads the files and hands the parsed tables in, so this is unit-testable and
 * usable from either process.
 */

export type ImportOrigin = 'toml' | 'rclone'

export interface ImportRow {
  /** Stable identity for selection, e.g. `transfer.host`. */
  id: string
  /** Where the value came from, e.g. `tracker.red.session` or `[nas] host`. */
  sourceKey: string
  origin: ImportOrigin
  section: SectionID
  /** Dotted path within the section. */
  field: string
  label: string
  sensitive: boolean
  currentValue: string
  newValue: string
  value: string | number | boolean
  kind: 'exact' | 'approximate'
  note?: string
  defaultSelected: boolean
}

export interface ImportSkip {
  sourceKey: string
  reason: string
}

export interface SalmonImportPlan {
  rows: ImportRow[]
  skipped: ImportSkip[]
  /** True when a `[[seedbox]]` uses rclone, so the Seedbox rows depend on rclone.conf. */
  rcloneNeeded: boolean
  /** Set when rclone.conf was needed but could not be used. */
  rcloneError?: string
  /** Path of the rclone.conf the plan was built from. */
  rcloneConfPath?: string
}

export type RcloneSource =
  | { path: string; remotes: RcloneRemote[]; osUsername: string }
  | { error: 'encrypted' | 'malformed' | 'missing'; message: string }

export interface SalmonImportInput {
  toml: Record<string, unknown>
  /** Remotes with `pass` already revealed by the main process. */
  rclone?: RcloneSource
}

// config.default.toml ships these literals; treat them as unset.
const PLACEHOLDERS = new Set([
  'api_key',
  'app-id',
  'discogs-token',
  'get-from-site-cookie',
  'password',
  'red-api-key',
  'ops-api-key',
  'dic-api-key',
  'user_auth_token',
  'username',
  'your-token'
])

function isPlaceholder(value: string): boolean {
  return value === '' || PLACEHOLDERS.has(value) || value.startsWith('path to ')
}

function table(source: unknown, key: string): Record<string, unknown> | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const value = (source as Record<string, unknown>)[key]
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function tableArray(source: unknown, key: string): Array<Record<string, unknown>> {
  if (typeof source !== 'object' || source === null) return []
  const value = (source as Record<string, unknown>)[key]
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is Record<string, unknown> =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry)
  )
}

/** Trimmed string, or undefined when absent or a config.default.toml placeholder. */
function str(source: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = source?.[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return isPlaceholder(trimmed) ? undefined : trimmed
}

function bool(source: Record<string, unknown> | undefined, key: string): boolean | undefined {
  const value = source?.[key]
  return typeof value === 'boolean' ? value : undefined
}

function int(source: Record<string, unknown> | undefined, key: string): number | undefined {
  const value = source?.[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.trunc(value)
}

function has(source: Record<string, unknown> | undefined, key: string): boolean {
  return source !== undefined && source[key] !== undefined
}

function readField(cfg: Config, section: SectionID, field: string): unknown {
  let cursor: unknown = cfg[section]
  for (const part of field.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function writeField(cfg: Config, section: SectionID, field: string, value: unknown): void {
  const parts = field.split('.')
  const last = parts.pop()!
  let cursor: Record<string, unknown> = cfg[section] as unknown as Record<string, unknown>
  for (const part of parts) {
    const next = cursor[part]
    if (typeof next !== 'object' || next === null) return
    cursor = next as Record<string, unknown>
  }
  cursor[last] = value
}

interface FieldMeta {
  label: string
  sensitive: boolean
}

function fieldMeta(section: SectionID, field: string): FieldMeta {
  const meta = sections()
    .find((s) => s.id === section)
    ?.fields.find((f) => f.name === field)
  if (meta) return { label: meta.label, sensitive: Boolean(meta.sensitive) }
  return { label: field, sensitive: false }
}

interface RowSpec {
  sourceKey: string
  origin?: ImportOrigin
  section: SectionID
  field: string
  value: string | number | boolean
  kind?: 'exact' | 'approximate'
  note?: string
  defaultSelected?: boolean
}

class PlanBuilder {
  readonly rows: ImportRow[] = []
  readonly skipped: ImportSkip[] = []

  constructor(private readonly current: Config) {}

  add(spec: RowSpec): void {
    const currentValue = String(readField(this.current, spec.section, spec.field) ?? '')
    const newValue = String(spec.value)
    // Nothing to review when the setting already holds this value.
    if (currentValue === newValue) return
    const meta = fieldMeta(spec.section, spec.field)
    this.rows.push({
      id: `${spec.section}.${spec.field}`,
      sourceKey: spec.sourceKey,
      origin: spec.origin ?? 'toml',
      section: spec.section,
      field: spec.field,
      label: meta.label,
      sensitive: meta.sensitive,
      currentValue,
      newValue,
      value: spec.value,
      kind: spec.kind ?? 'exact',
      note: spec.note,
      defaultSelected: spec.defaultSelected ?? true
    })
  }

  skip(sourceKey: string, reason: string): void {
    this.skipped.push({ sourceKey, reason })
  }
}

export function buildSalmonImportPlan(
  input: SalmonImportInput,
  current: Config
): SalmonImportPlan {
  const builder = new PlanBuilder(current)
  const toml = input.toml

  mapDirectories(builder, toml)
  mapImages(builder, toml)
  mapTrackers(builder, toml)
  mapUpload(builder, toml)
  mapMetadata(builder, toml)
  const seedbox = mapSeedboxes(builder, toml, input.rclone)

  return {
    rows: builder.rows,
    skipped: builder.skipped,
    rcloneNeeded: seedbox.rcloneNeeded,
    ...(seedbox.rcloneError ? { rcloneError: seedbox.rcloneError } : {}),
    ...(seedbox.rcloneConfPath ? { rcloneConfPath: seedbox.rcloneConfPath } : {})
  }
}

function mapDirectories(builder: PlanBuilder, toml: Record<string, unknown>): void {
  const directory = table(toml, 'directory')
  if (!directory) return

  const download = str(directory, 'download_directory')
  if (download !== undefined) {
    builder.add({
      sourceKey: 'directory.download_directory',
      section: 'directories',
      field: 'seeding',
      value: download
    })
  }

  const dottorrents = str(directory, 'dottorrents_dir')
  if (dottorrents !== undefined) {
    builder.add({
      sourceKey: 'directory.dottorrents_dir',
      section: 'directories',
      field: 'torrents',
      value: dottorrents
    })
  }

  if (has(directory, 'tmp_dir') || has(directory, 'clean_tmp_dir')) {
    builder.skip(
      'directory.tmp_dir',
      'Gravlax generates spectrals inside its own workspace copy and cleans it up via Cleanup Rules.'
    )
  }
  if (has(directory, 'hardlinks')) {
    builder.skip('directory.hardlinks', 'Gravlax hardlinks automatically when the volume allows it.')
  }
}

const SPECTRAL_ID_SELECTION: Record<string, string> = { '*': 'All', '+': 'Random', '0': 'None' }
const SUPPORTED_IMAGE_HOSTS = new Set(['imgbb'])

function mapImages(builder: PlanBuilder, toml: Record<string, unknown>): void {
  const image = table(toml, 'image')
  if (!image) return

  const imageUploader = str(image, 'image_uploader')
  const coverUploader = str(image, 'cover_uploader')
  const specsUploader = str(image, 'specs_uploader')

  const imgbbKey = str(image, 'imgbb_key')
  if (imgbbKey !== undefined) {
    builder.add({
      sourceKey: 'image.imgbb_key',
      section: 'imageHosts',
      field: 'imgbb.apiKey',
      value: imgbbKey
    })
  }

  const usesImgbb = [imageUploader, coverUploader, specsUploader].includes('imgbb')
  if (usesImgbb && imgbbKey !== undefined) {
    builder.add({
      sourceKey: 'image.*_uploader',
      section: 'imageHosts',
      field: 'imgbb.enabled',
      value: true
    })
  }

  if (specsUploader === 'imgbb') {
    builder.add({
      sourceKey: 'image.specs_uploader',
      section: 'spectral',
      field: 'imageHost',
      value: 'imgbb'
    })
  }

  if (coverUploader === 'imgbb') {
    builder.add({
      sourceKey: 'image.cover_uploader',
      section: 'trackers',
      field: 'redacted.coverImageHost',
      value: 'imgbb'
    })
    builder.add({
      sourceKey: 'image.cover_uploader',
      section: 'trackers',
      field: 'orpheus.coverImageHost',
      value: 'imgbb'
    })
  }

  for (const [key, host] of [
    ['image.image_uploader', imageUploader],
    ['image.cover_uploader', coverUploader],
    ['image.specs_uploader', specsUploader]
  ] as const) {
    if (host !== undefined && !SUPPORTED_IMAGE_HOSTS.has(host)) {
      builder.skip(`${key} = "${host}"`, 'Gravlax supports imgbb, Ra (thesungod) and the Redacted host.')
    }
  }

  for (const key of ['ptpimg_key', 'ptscreens_key', 'oeimg_key'] as const) {
    if (str(image, key) !== undefined) {
      builder.skip(`image.${key}`, 'That image host is not supported by Gravlax.')
    }
  }

  const spectralIds = str(image, 'default_spectral_ids')
  if (spectralIds !== undefined) {
    const mapped = SPECTRAL_ID_SELECTION[spectralIds]
    if (mapped) {
      builder.add({
        sourceKey: 'image.default_spectral_ids',
        section: 'spectral',
        field: 'defaultSpectralIds',
        value: mapped
      })
    } else {
      builder.skip('image.default_spectral_ids', `Unrecognised selection "${spectralIds}".`)
    }
  }
}

function mapTrackers(builder: PlanBuilder, toml: Record<string, unknown>): void {
  const tracker = table(toml, 'tracker')
  if (!tracker) return

  for (const [salmonKey, gravlaxKey] of [
    ['red', 'redacted'],
    ['ops', 'orpheus']
  ] as const) {
    const site = table(tracker, salmonKey)
    if (!site) continue

    const session = str(site, 'session')
    if (session !== undefined) {
      builder.add({
        sourceKey: `tracker.${salmonKey}.session`,
        section: 'trackers',
        field: `${gravlaxKey}.sessionCookie`,
        value: session
      })
    }

    const apiKey = str(site, 'api_key')
    if (apiKey !== undefined) {
      builder.add({
        sourceKey: `tracker.${salmonKey}.api_key`,
        section: 'trackers',
        field: `${gravlaxKey}.apiKey`,
        value: apiKey
      })
    }

    if (session !== undefined || apiKey !== undefined) {
      builder.skip(
        `tracker.${salmonKey} site and announce URL`,
        'smoked-salmon builds these at runtime from your passkey, so fill them in by hand before enabling the tracker.'
      )
    }

    if (str(site, 'dottorrents_dir') !== undefined) {
      builder.skip(
        `tracker.${salmonKey}.dottorrents_dir`,
        'Gravlax writes every .torrent to the single Directories → Torrents folder.'
      )
    }
  }

  if (table(tracker, 'dic')) {
    builder.skip('tracker.dic', 'Gravlax supports Redacted and Orpheus only.')
  }
  if (str(tracker, 'default_tracker') !== undefined) {
    builder.skip('tracker.default_tracker', 'Gravlax has no default-tracker setting.')
  }
}

// smoked-salmon writes template tokens in lowercase; Gravlax uses camelCase.
const TEMPLATE_TOKENS: Record<string, string> = {
  tracknumber: 'trackNumber',
  discnumber: 'discNumber',
  disctotal: 'discTotal',
  albumartist: 'albumArtist',
  groupyear: 'groupYear',
  editiontitle: 'editionTitle',
  releasetype: 'releaseType',
  catno: 'catNo'
}

export function rewriteTemplateTokens(template: string): string {
  return template.replace(/\{([^{}]+)\}/g, (match, token: string) => {
    const mapped = TEMPLATE_TOKENS[token.trim().toLowerCase()]
    return mapped ? `{${mapped}}` : match
  })
}

function mapUpload(builder: PlanBuilder, toml: Record<string, unknown>): void {
  const upload = table(toml, 'upload')
  if (!upload) return

  const compression = table(upload, 'compression')
  const compressSpectrals = bool(compression, 'compress_spectrals')
  if (compressSpectrals !== undefined) {
    builder.add({
      sourceKey: 'upload.compression.compress_spectrals',
      section: 'spectral',
      field: 'compress',
      value: compressSpectrals
    })
  }
  const useUpc = bool(compression, 'use_upc_as_catno')
  if (useUpc !== undefined) {
    builder.add({
      sourceKey: 'upload.compression.use_upc_as_catno',
      section: 'workflow',
      field: 'useUpcAsCatNo',
      value: useUpc
    })
  }
  if (int(compression, 'flac_compression_level') !== undefined) {
    builder.skip('upload.compression.flac_compression_level', 'Gravlax always encodes FLAC at level 8.')
  }

  const formatting = table(upload, 'formatting')
  addTemplateRow(builder, {
    sourceKey: 'upload.formatting.folder_template',
    field: 'releaseFolderTemplate',
    template: str(formatting, 'folder_template'),
    validate: validateReleaseFolderTemplate
  })
  addTemplateRow(builder, {
    sourceKey: 'upload.formatting.file_template',
    field: 'trackFileTemplate',
    template: str(formatting, 'file_template'),
    validate: validateTrackFileTemplate
  })
  if (str(formatting, 'one_album_artist_file_template') !== undefined) {
    builder.skip(
      'upload.formatting.one_album_artist_file_template',
      'Gravlax uses one track template regardless of how many album artists there are.'
    )
  }

  for (const key of ['search', 'description', 'web_interface', 'requests', 'ai_review'] as const) {
    if (table(upload, key)) {
      builder.skip(`upload.${key}`, 'No equivalent in Gravlax.')
    }
  }
}

function addTemplateRow(
  builder: PlanBuilder,
  spec: {
    sourceKey: string
    field: 'releaseFolderTemplate' | 'trackFileTemplate'
    template: string | undefined
    validate: (template: string) => string[]
  }
): void {
  if (spec.template === undefined) return
  const rewritten = rewriteTemplateTokens(spec.template)
  const errors = spec.validate(rewritten)
  const renamed = rewritten !== spec.template
  builder.add({
    sourceKey: spec.sourceKey,
    section: 'naming',
    field: spec.field,
    value: rewritten,
    kind: 'approximate',
    note:
      errors.length > 0
        ? `${errors.join(' ')} Fix or drop the field before saving.`
        : renamed
          ? 'Template fields renamed to match Gravlax.'
          : undefined,
    // A template Gravlax cannot render would block Save, so leave it off by default.
    defaultSelected: errors.length === 0
  })
}

function mapMetadata(builder: PlanBuilder, toml: Record<string, unknown>): void {
  const metadata = table(toml, 'metadata')
  if (!metadata) return

  const providers: Array<[string, boolean]> = [
    ['metadata.discogs_token', str(metadata, 'discogs_token') !== undefined],
    ['metadata.tidal', str(table(metadata, 'tidal'), 'token') !== undefined],
    ['metadata.qobuz', str(table(metadata, 'qobuz'), 'app_id') !== undefined],
    ['metadata.beatport', str(table(metadata, 'beatport'), 'username') !== undefined],
    ['metadata.apple_music', table(metadata, 'apple_music') !== undefined]
  ]
  for (const [key, present] of providers) {
    if (present) {
      builder.skip(key, 'Gravlax fetches metadata from MusicBrainz and Deezer only.')
    }
  }
}

interface SeedboxOutcome {
  rcloneNeeded: boolean
  rcloneError?: string
  rcloneConfPath?: string
}

function mapSeedboxes(
  builder: PlanBuilder,
  toml: Record<string, unknown>,
  rclone: RcloneSource | undefined
): SeedboxOutcome {
  const entries = tableArray(toml, 'seedbox')
  if (entries.length === 0) return { rcloneNeeded: false }

  const client = entries.find((entry) => str(entry, 'torrent_client') !== undefined)
  const remote = entries.find((entry) => str(entry, 'type') === 'rclone')

  if (client) mapTorrentClient(builder, client, str(client, 'type') === 'rclone')

  for (const entry of entries) {
    if (entry['flac_only'] === true) {
      builder.skip('seedbox.flac_only', 'Gravlax uploads every file in the release folder.')
    }
    if (Array.isArray(entry['extra_args']) && entry['extra_args'].length > 0) {
      builder.skip('seedbox.extra_args', 'These are rclone flags; Gravlax talks SFTP directly.')
    }
  }

  if (!remote) return { rcloneNeeded: false }
  return mapRcloneSeedbox(builder, remote, rclone)
}

function mapTorrentClient(
  builder: PlanBuilder,
  seedbox: Record<string, unknown>,
  usesRclone: boolean
): void {
  const raw = str(seedbox, 'torrent_client')!
  const separator = raw.indexOf('+')
  const kind = separator === -1 ? raw : raw.slice(0, separator)
  if (kind !== 'qbittorrent') {
    builder.skip(`seedbox.torrent_client = "${kind}"`, 'Gravlax injects torrents into qBittorrent only.')
    return
  }

  let parsed: URL
  try {
    parsed = new URL(raw.slice(separator + 1))
  } catch {
    builder.skip('seedbox.torrent_client', `Could not read "${raw}" as a URL.`)
    return
  }

  builder.add({
    sourceKey: 'seedbox.torrent_client',
    section: 'torrentClient',
    field: 'url',
    value: `${parsed.protocol}//${parsed.host}`,
    kind: 'approximate',
    note: 'Taken from the qBittorrent connection string.'
  })
  if (parsed.username !== '') {
    builder.add({
      sourceKey: 'seedbox.torrent_client',
      section: 'torrentClient',
      field: 'username',
      value: decodeURIComponent(parsed.username)
    })
  }
  if (parsed.password !== '') {
    builder.add({
      sourceKey: 'seedbox.torrent_client',
      section: 'torrentClient',
      field: 'password',
      value: decodeURIComponent(parsed.password)
    })
  }

  const enabled = bool(seedbox, 'enabled')
  if (enabled !== undefined) {
    builder.add({
      sourceKey: 'seedbox.enabled',
      section: 'torrentClient',
      field: 'enabled',
      value: enabled
    })
  }

  const label = str(seedbox, 'label')
  if (label !== undefined) {
    builder.add({ sourceKey: 'seedbox.label', section: 'torrentClient', field: 'category', value: label })
  }

  const addPaused = bool(seedbox, 'add_paused')
  if (addPaused !== undefined) {
    builder.add({
      sourceKey: 'seedbox.add_paused',
      section: 'torrentClient',
      field: 'startPaused',
      value: addPaused
    })
  }

  // With rclone the directory is the remote destination, so it belongs to the
  // Seedbox section instead and qBittorrent falls back to it.
  const directory = str(seedbox, 'directory')
  if (directory !== undefined && !usesRclone) {
    builder.add({
      sourceKey: 'seedbox.directory',
      section: 'torrentClient',
      field: 'savePath',
      value: directory
    })
  }
}

function mapRcloneSeedbox(
  builder: PlanBuilder,
  seedbox: Record<string, unknown>,
  rclone: RcloneSource | undefined
): SeedboxOutcome {
  const name = str(seedbox, 'url')
  if (name === undefined) {
    builder.skip('seedbox.url', 'The seedbox uses rclone but does not name a remote.')
    return { rcloneNeeded: true }
  }

  if (!rclone) {
    return {
      rcloneNeeded: true,
      rcloneError: `Could not find an rclone.conf, so the Seedbox settings behind the "${name}" remote were not imported.`
    }
  }
  if ('error' in rclone) {
    return { rcloneNeeded: true, rcloneError: rclone.message }
  }

  const remote = rclone.remotes.find((candidate) => candidate.name === name)
  if (!remote) {
    return {
      rcloneNeeded: true,
      rcloneConfPath: rclone.path,
      rcloneError: `${rclone.path} has no remote named "${name}".`
    }
  }
  if (remote.type !== 'sftp') {
    builder.skip(
      `rclone [${name}] type = ${remote.type || 'unset'}`,
      'Gravlax transfers over SFTP, so only sftp remotes can be imported.'
    )
    return { rcloneNeeded: true, rcloneConfPath: rclone.path }
  }

  const source = (key: string): string => `rclone [${name}] ${key}`
  const values = remote.values

  const host = values['host']?.trim()
  if (host) {
    builder.add({
      sourceKey: source('host'),
      origin: 'rclone',
      section: 'transfer',
      field: 'host',
      value: host
    })
  }

  const user = values['user']?.trim()
  if (user) {
    builder.add({
      sourceKey: source('user'),
      origin: 'rclone',
      section: 'transfer',
      field: 'username',
      value: user
    })
  } else {
    // rclone omits any option left at its default, and the sftp user defaults
    // to whoever is logged in, so an absent `user` means "the local username".
    builder.add({
      sourceKey: source('user'),
      origin: 'rclone',
      section: 'transfer',
      field: 'username',
      value: rclone.osUsername,
      kind: 'approximate',
      note: `rclone left this out because it matched the logged-in user. Check it is really "${rclone.osUsername}" on the seedbox.`
    })
  }

  const port = Number.parseInt(values['port'] ?? '', 10)
  builder.add({
    sourceKey: source('port'),
    origin: 'rclone',
    section: 'transfer',
    field: 'port',
    value: Number.isFinite(port) && port > 0 ? port : 22
  })

  const pass = values['pass']?.trim()
  if (pass) {
    builder.add({
      sourceKey: source('pass'),
      origin: 'rclone',
      section: 'transfer',
      field: 'password',
      value: pass
    })
  }

  const keyFile = values['key_file']?.trim()
  if (keyFile) {
    builder.add({
      sourceKey: source('key_file'),
      origin: 'rclone',
      section: 'transfer',
      field: 'privateKeyPath',
      value: keyFile
    })
  }

  if (!pass && !keyFile) {
    builder.skip(
      source('pass'),
      'The remote authenticates through ssh-agent. Gravlax needs a password or a private key, so set one by hand.'
    )
  }

  const enabled = bool(seedbox, 'enabled')
  if (enabled !== undefined) {
    builder.add({
      sourceKey: 'seedbox.enabled',
      origin: 'rclone',
      section: 'transfer',
      field: 'enabled',
      value: enabled
    })
  }

  const directory = str(seedbox, 'directory')
  if (directory !== undefined) {
    builder.add({
      sourceKey: 'seedbox.directory',
      origin: 'rclone',
      section: 'transfer',
      field: 'remotePath',
      value: directory
    })
  }

  return { rcloneNeeded: true, rcloneConfPath: rclone.path }
}

export function applySalmonImport(
  current: Config,
  plan: SalmonImportPlan,
  selected: ReadonlySet<string>
): Config {
  const next = structuredClone(current)
  for (const row of plan.rows) {
    if (!selected.has(row.id)) continue
    writeField(next, row.section, row.field, row.value)
  }
  // Same invariants the Settings screen enforces after an edit.
  if (!canEnableRedactedImageHost(next)) next.imageHosts.redacted.enabled = false
  sanitizeCoverImageHosts(next)
  return next
}
