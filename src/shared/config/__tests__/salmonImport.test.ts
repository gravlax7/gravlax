import { describe, expect, it } from 'vitest'
import type { Config } from '@shared/types/config'
import type { RcloneRemote } from '@shared/config/rcloneConf'
import {
  applySalmonImport,
  buildSalmonImportPlan,
  rewriteTemplateTokens,
  type ImportRow,
  type SalmonImportInput,
  type SalmonImportPlan
} from '@shared/config/salmonImport'

// Mirrors src/main/core/config/defaults.ts; @main is not on the renderer's
// tsconfig path map, and this file has to typecheck under both projects.
function defaultConfig(): Config {
  const tracker = {
    enabled: false,
    siteUrl: '',
    announceUrl: '',
    apiKey: '',
    sessionCookie: '',
    coverImageHost: ''
  }
  return {
    appearance: { theme: 'system' },
    directories: { source: '', torrents: '', seeding: '' },
    tools: { sox: '', flac: '', metaflac: '', mp3val: '', lame: '' },
    trackers: { redacted: { ...tracker }, orpheus: { ...tracker } },
    metadataProviders: {
      musicBrainz: { enabled: true },
      deezer: { enabled: false },
      requestTimeoutSeconds: 10
    },
    imageHosts: {
      thesungod: { enabled: false, apiKey: '' },
      imgbb: { enabled: false, apiKey: '' },
      catbox: { enabled: true },
      redacted: { enabled: false }
    },
    torrentClient: {
      enabled: false,
      url: '',
      username: '',
      password: '',
      category: '',
      useAutoTMM: false,
      savePath: '',
      startPaused: false
    },
    transfer: {
      enabled: false,
      host: '',
      port: 22,
      username: '',
      password: '',
      privateKeyPath: '',
      remotePath: ''
    },
    naming: {
      albumDescriptionTemplateId: 'peachfuzz',
      releaseFolderTemplate: '{artists} - {title} ({year}) [{source} {format}]',
      trackFileTemplate: '{trackNumber}. {title}',
      multiDiscFolderTemplate: 'Disc {discNumber}'
    },
    spectral: {
      imageHost: '',
      defaultSpectralIds: 'Random',
      defaultSpectralIdsForLossyMasters: 'All'
    },
    cleanup: { deleteTemporaryFiles: true, deleteSpectralsAfterUpload: false },
    workflow: { confirmBeforeWrites: true, useUpcAsCatNo: true }
  }
}

function plan(toml: Record<string, unknown>, options?: Partial<SalmonImportInput>): SalmonImportPlan {
  return buildSalmonImportPlan({ toml, ...options }, defaultConfig())
}

function planWithCatboxDisabled(toml: Record<string, unknown>): SalmonImportPlan {
  const current = defaultConfig()
  current.imageHosts.catbox.enabled = false
  return buildSalmonImportPlan({ toml }, current)
}

function row(result: SalmonImportPlan, id: string): ImportRow | undefined {
  return result.rows.find((candidate) => candidate.id === id)
}

function values(result: SalmonImportPlan): Record<string, string | number | boolean> {
  return Object.fromEntries(result.rows.map((candidate) => [candidate.id, candidate.value]))
}

function sftpRemote(overrides: Record<string, string> = {}): RcloneRemote {
  const remoteValues = { type: 'sftp', host: 'seedbox.example.com', ...overrides }
  return { name: 'nas', type: remoteValues['type']!, values: remoteValues }
}

const rcloneSource = (remotes: RcloneRemote[]): SalmonImportInput['rclone'] => ({
  path: '/home/ben/.config/rclone/rclone.conf',
  remotes,
  osUsername: 'ben'
})

describe('buildSalmonImportPlan — directories and trackers', () => {
  it('maps the two directories smoked-salmon and Gravlax share', () => {
    const result = plan({
      directory: { download_directory: '/srv/seeding', dottorrents_dir: '/srv/torrents' }
    })
    expect(values(result)).toMatchObject({
      'directories.seeding': '/srv/seeding',
      'directories.torrents': '/srv/torrents'
    })
  })

  it('maps tracker credentials and enable switches without changing tracker addresses', () => {
    const result = plan({
      tracker: {
        default_tracker: 'RED',
        red: { session: 'red-cookie', api_key: 'red-key' },
        ops: { session: 'ops-cookie' },
        dic: { session: 'dic-cookie' }
      }
    })

    expect(values(result)).toEqual({
      'trackers.redacted.sessionCookie': 'red-cookie',
      'trackers.redacted.apiKey': 'red-key',
      'trackers.redacted.enabled': true,
      'trackers.orpheus.sessionCookie': 'ops-cookie',
      'trackers.orpheus.enabled': true
    })
    expect(row(result, 'trackers.redacted.enabled')).toMatchObject({ defaultSelected: false })
    expect(row(result, 'trackers.orpheus.enabled')).toMatchObject({ defaultSelected: false })
    expect(result.rows.some((candidate) => candidate.field.endsWith('siteUrl'))).toBe(false)
    expect(result.rows.some((candidate) => candidate.field.endsWith('announceUrl'))).toBe(false)
    expect(result.skipped.map((skip) => skip.sourceKey)).toEqual(
      expect.arrayContaining(['tracker.dic', 'tracker.default_tracker'])
    )
  })

  it('selects an imported tracker enable switch when its address fields are already set', () => {
    const current = defaultConfig()
    current.trackers.redacted.siteUrl = 'configured-site'
    current.trackers.redacted.announceUrl = 'configured-announce'
    const result = buildSalmonImportPlan(
      { toml: { tracker: { red: { session: 'red-cookie' } } } },
      current
    )

    expect(row(result, 'trackers.redacted.enabled')).toMatchObject({
      value: true,
      defaultSelected: true
    })
  })

  it('ignores the placeholders shipped in config.default.toml', () => {
    const result = plan({
      directory: { download_directory: '.music', dottorrents_dir: 'path to dir' },
      image: { imgbb_key: 'api_key' },
      tracker: { red: { session: 'get-from-site-cookie' } },
      metadata: { discogs_token: 'discogs-token' }
    })

    expect(values(result)).toEqual({ 'directories.seeding': '.music' })
    expect(result.skipped.map((skip) => skip.sourceKey)).not.toContain('metadata.discogs_token')
  })

  it('drops rows whose value already matches the current config', () => {
    const current = defaultConfig()
    current.directories.seeding = '/srv/seeding'
    const result = buildSalmonImportPlan(
      { toml: { directory: { download_directory: '/srv/seeding', dottorrents_dir: '/srv/torrents' } } },
      current
    )
    expect(result.rows.map((candidate) => candidate.id)).toEqual(['directories.torrents'])
  })
})

describe('buildSalmonImportPlan — image hosts and spectrals', () => {
  it('imports imgbb and flags every other host as unsupported', () => {
    const result = plan({
      image: {
        image_uploader: 'imgbb',
        cover_uploader: 'imgbb',
        specs_uploader: 'ptpimg',
        imgbb_key: 'imgbb-key',
        ptpimg_key: 'ptpimg-key'
      }
    })

    expect(values(result)).toMatchObject({
      'imageHosts.imgbb.apiKey': 'imgbb-key',
      'imageHosts.imgbb.enabled': true,
      'trackers.redacted.coverImageHost': 'imgbb',
      'trackers.orpheus.coverImageHost': 'imgbb'
    })
    expect(row(result, 'spectral.imageHost')).toBeUndefined()
    expect(result.skipped.map((skip) => skip.sourceKey)).toEqual(
      expect.arrayContaining(['image.specs_uploader = "ptpimg"', 'image.ptpimg_key'])
    )
  })

  it('points the spectral host at imgbb when salmon uploads spectrals there', () => {
    const result = plan({ image: { specs_uploader: 'imgbb', imgbb_key: 'imgbb-key' } })
    expect(values(result)).toMatchObject({ 'spectral.imageHost': 'imgbb' })
  })

  it('imports catbox for general, cover, and spectral uploads', () => {
    const result = planWithCatboxDisabled({
      image: {
        image_uploader: 'catbox',
        cover_uploader: 'catbox',
        specs_uploader: 'catbox'
      }
    })

    expect(values(result)).toMatchObject({
      'imageHosts.catbox.enabled': true,
      'trackers.redacted.coverImageHost': 'catbox',
      'trackers.orpheus.coverImageHost': 'catbox',
      'spectral.imageHost': 'catbox'
    })
    expect(result.skipped).toEqual([])
  })

  it.each(['image_uploader', 'cover_uploader', 'specs_uploader'])(
    'enables catbox when %s selects it',
    (setting) => {
      const result = planWithCatboxDisabled({ image: { [setting]: 'catbox' } })
      expect(values(result)).toMatchObject({ 'imageHosts.catbox.enabled': true })
    }
  )

  it('leaves imgbb disabled when it is selected but has no key', () => {
    const result = plan({ image: { cover_uploader: 'imgbb' } })
    expect(row(result, 'imageHosts.imgbb.enabled')).toBeUndefined()
  })

  it('enables imgbb whenever its key is imported', () => {
    const result = plan({ image: { image_uploader: 'ptpimg', imgbb_key: 'imgbb-key' } })
    expect(values(result)).toMatchObject({
      'imageHosts.imgbb.apiKey': 'imgbb-key',
      'imageHosts.imgbb.enabled': true
    })
  })

  it('translates the spectral id selection symbols', () => {
    expect(values(plan({ image: { default_spectral_ids: '*' } }))).toMatchObject({
      'spectral.defaultSpectralIds': 'All'
    })
    expect(values(plan({ image: { default_spectral_ids: '0' } }))).toMatchObject({
      'spectral.defaultSpectralIds': 'None'
    })
    // '+' is the Gravlax default, so there is nothing to change.
    expect(plan({ image: { default_spectral_ids: '+' } }).rows).toEqual([])
    expect(plan({ image: { default_spectral_ids: '?' } }).skipped).toEqual([
      { sourceKey: 'image.default_spectral_ids', reason: 'Unrecognised selection "?".' }
    ])
  })
})

describe('buildSalmonImportPlan — naming templates', () => {
  it('rewrites lowercase tokens to the Gravlax spelling', () => {
    expect(rewriteTemplateTokens('{tracknumber}. {artist} - {title}')).toBe(
      '{trackNumber}. {artist} - {title}'
    )
    expect(rewriteTemplateTokens('{albumartist} [{catno}] {releasetype}')).toBe(
      '{albumArtist} [{catNo}] {releaseType}'
    )
  })

  it('imports rewritten templates as approximate rows', () => {
    const result = plan({
      upload: { formatting: { file_template: '{tracknumber}. {artist} - {title}' } }
    })
    const template = row(result, 'naming.trackFileTemplate')!
    expect(template.value).toBe('{trackNumber}. {artist} - {title}')
    expect(template.kind).toBe('approximate')
    expect(template.defaultSelected).toBe(true)
    expect(template.note).toBe('Template fields renamed to match Gravlax.')
  })

  it('leaves a template Gravlax cannot render unchecked and says why', () => {
    const result = plan({
      upload: { formatting: { folder_template: '{artists} - {title} {bitrate}' } }
    })
    const template = row(result, 'naming.releaseFolderTemplate')!
    expect(template.defaultSelected).toBe(false)
    expect(template.note).toContain('{bitrate}')
  })
})

describe('buildSalmonImportPlan — torrent client', () => {
  it('parses a qBittorrent connection string', () => {
    const result = plan({
      seedbox: [
        {
          enabled: true,
          type: 'local',
          directory: '/srv/data',
          label: 'gravlax',
          add_paused: true,
          torrent_client: 'qbittorrent+http://admin:s3cret@127.0.0.1:8080'
        }
      ]
    })

    expect(values(result)).toMatchObject({
      'torrentClient.url': 'http://127.0.0.1:8080',
      'torrentClient.username': 'admin',
      'torrentClient.password': 's3cret',
      'torrentClient.enabled': true,
      'torrentClient.category': 'gravlax',
      'torrentClient.startPaused': true,
      'torrentClient.savePath': '/srv/data'
    })
    expect(result.rcloneNeeded).toBe(false)
    expect(row(result, 'torrentClient.enabled')?.defaultSelected).toBe(true)
  })

  it('leaves qBittorrent off when the imported setup has no usable destination', () => {
    const result = plan({
      seedbox: [
        {
          enabled: true,
          type: 'rclone',
          url: 'nas',
          directory: '',
          torrent_client: 'qbittorrent+http://admin:s3cret@127.0.0.1:8080'
        }
      ]
    })

    const enabled = row(result, 'torrentClient.enabled')!
    expect(enabled.defaultSelected).toBe(false)
    expect(enabled.note).toContain('save path or an enabled seedbox')
    expect(row(result, 'torrentClient.url')?.defaultSelected).toBe(true)
  })

  it('skips torrent clients Gravlax cannot drive', () => {
    const result = plan({
      seedbox: [{ torrent_client: 'deluge://user:pass@127.0.0.1:58664' }]
    })
    expect(result.rows).toEqual([])
    expect(result.skipped[0]).toMatchObject({ sourceKey: 'seedbox.torrent_client = "deluge://user:pass@127.0.0.1:58664"' })
  })

})

describe('buildSalmonImportPlan — seedbox via rclone', () => {
  const seedbox = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    enabled: true,
    type: 'rclone',
    url: 'nas',
    directory: '/home/uploader/data',
    ...overrides
  })

  it('fills the Seedbox section from a matching sftp remote', () => {
    const result = plan(
      { seedbox: [seedbox()] },
      {
        rclone: rcloneSource([
          sftpRemote({ user: 'uploader', port: '2222', pass: 'revealed', key_file: '~/.ssh/id_ed25519' })
        ])
      }
    )

    expect(values(result)).toMatchObject({
      'transfer.host': 'seedbox.example.com',
      'transfer.username': 'uploader',
      'transfer.port': 2222,
      'transfer.password': 'revealed',
      'transfer.privateKeyPath': '~/.ssh/id_ed25519',
      'transfer.enabled': true,
      'transfer.remotePath': '/home/uploader/data'
    })
    expect(result.rcloneNeeded).toBe(true)
    expect(result.rcloneError).toBeUndefined()
    expect(result.rows.filter((candidate) => candidate.origin === 'rclone')).toHaveLength(7)
  })

  it('falls back to the local username when rclone elided the default user', () => {
    const result = plan(
      { seedbox: [seedbox()] },
      { rclone: rcloneSource([sftpRemote({ pass: 'revealed' })]) }
    )

    const username = row(result, 'transfer.username')!
    expect(username.value).toBe('ben')
    expect(username.kind).toBe('approximate')
    expect(username.note).toContain('matched the logged-in user')
    // port is elided too, and 22 is already the Gravlax default
    expect(row(result, 'transfer.port')).toBeUndefined()
  })

  it('warns that an ssh-agent remote has no credentials to import', () => {
    const result = plan(
      { seedbox: [seedbox()] },
      { rclone: rcloneSource([sftpRemote({ user: 'uploader' })]) }
    )
    expect(row(result, 'transfer.password')).toBeUndefined()
    expect(row(result, 'transfer.privateKeyPath')).toBeUndefined()
    expect(result.skipped.map((skip) => skip.reason)).toEqual(
      expect.arrayContaining([expect.stringContaining('ssh-agent')])
    )
    const enabled = row(result, 'transfer.enabled')!
    expect(enabled.defaultSelected).toBe(false)
    expect(enabled.note).toContain('SFTP settings are incomplete')
  })

  it('gives the rclone directory to the Seedbox section, not qBittorrent', () => {
    const result = plan(
      {
        seedbox: [seedbox({ torrent_client: 'qbittorrent+http://admin:pw@10.0.0.2:8080' })]
      },
      { rclone: rcloneSource([sftpRemote({ user: 'uploader' })]) }
    )
    expect(row(result, 'torrentClient.savePath')).toBeUndefined()
    expect(row(result, 'transfer.remotePath')!.value).toBe('/home/uploader/data')
  })

  it('refuses remote types other than sftp', () => {
    const result = plan(
      { seedbox: [seedbox()] },
      { rclone: rcloneSource([{ name: 'nas', type: 'webdav', values: { type: 'webdav', url: 'https://x' } }]) }
    )
    expect(result.rows.filter((candidate) => candidate.section === 'transfer')).toEqual([])
    expect(result.skipped.map((skip) => skip.sourceKey)).toContain('rclone [nas] type = webdav')
  })

  it('explains when the named remote is missing from rclone.conf', () => {
    const result = plan(
      { seedbox: [seedbox()] },
      { rclone: rcloneSource([{ ...sftpRemote(), name: 'other' }]) }
    )
    expect(result.rcloneError).toContain('has no remote named "nas"')
  })

  it('explains when no rclone.conf was found at all', () => {
    const result = plan({ seedbox: [seedbox()] })
    expect(result.rcloneNeeded).toBe(true)
    expect(result.rcloneError).toContain('Could not find an rclone.conf')
  })

  it('passes through the reason an rclone.conf could not be read', () => {
    const result = plan(
      { seedbox: [seedbox()] },
      { rclone: { error: 'encrypted', message: 'This rclone config is password-protected.' } }
    )
    expect(result.rcloneError).toBe('This rclone config is password-protected.')
  })
})

describe('applySalmonImport', () => {
  const toml = {
    directory: { download_directory: '/srv/seeding', dottorrents_dir: '/srv/torrents' },
    tracker: { red: { session: 'red-cookie' } }
  }

  it('writes only the selected rows', () => {
    const current = defaultConfig()
    const result = buildSalmonImportPlan({ toml }, current)
    const next = applySalmonImport(current, result, new Set(['directories.seeding']))

    expect(next.directories.seeding).toBe('/srv/seeding')
    expect(next.directories.torrents).toBe('')
    expect(next.trackers.redacted.sessionCookie).toBe('')
    // The source config is never mutated.
    expect(current.directories.seeding).toBe('')
  })

  it('writes every row when all are selected', () => {
    const current = defaultConfig()
    const result = buildSalmonImportPlan({ toml }, current)
    const next = applySalmonImport(current, result, new Set(result.rows.map((r) => r.id)))

    expect(next.directories).toEqual({ source: '', seeding: '/srv/seeding', torrents: '/srv/torrents' })
    expect(next.trackers.redacted.sessionCookie).toBe('red-cookie')
  })

  it('drops a cover image host whose image host was left unselected', () => {
    const current = defaultConfig()
    const result = buildSalmonImportPlan(
      { toml: { image: { cover_uploader: 'imgbb', imgbb_key: 'imgbb-key' } } },
      current
    )
    const next = applySalmonImport(
      current,
      result,
      new Set(['trackers.redacted.coverImageHost', 'trackers.orpheus.coverImageHost'])
    )

    expect(next.imageHosts.imgbb.enabled).toBe(false)
    expect(next.trackers.redacted.coverImageHost).toBe('')
    expect(next.trackers.orpheus.coverImageHost).toBe('')
  })

  it('keeps the cover image host when imgbb comes along with it', () => {
    const current = defaultConfig()
    const result = buildSalmonImportPlan(
      { toml: { image: { cover_uploader: 'imgbb', imgbb_key: 'imgbb-key' } } },
      current
    )
    const next: Config = applySalmonImport(current, result, new Set(result.rows.map((r) => r.id)))

    expect(next.imageHosts.imgbb).toEqual({ enabled: true, apiKey: 'imgbb-key' })
    expect(next.trackers.redacted.coverImageHost).toBe('imgbb')
  })
})

describe('buildSalmonImportPlan — malformed input', () => {
  it('survives tables that are not tables', () => {
    const result = plan({ directory: 'nope', tracker: 42, seedbox: 'no', image: null })
    expect(result.rows).toEqual([])
    expect(result.skipped).toEqual([])
  })

  it('survives an empty file', () => {
    expect(plan({})).toEqual({ rows: [], skipped: [], rcloneNeeded: false })
  })
})
