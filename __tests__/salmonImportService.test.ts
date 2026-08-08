import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSalmonImportSources } from '@main/services/salmonImportService'
import { buildSalmonImportPlan } from '@shared/config/salmonImport'
import { defaultConfig } from '@main/core/config/defaults'

const CONFIG_TOML = `
[directory]
download_directory = '/srv/seeding'
dottorrents_dir = '/srv/torrents'

[image]
image_uploader = "imgbb"
cover_uploader = "imgbb"
specs_uploader = "imgbb"
imgbb_key = 'imgbb-secret'
default_spectral_ids = "*"

[tracker]
default_tracker = 'RED'

[tracker.red]
session = 'red-session-cookie'
api_key = 'red-api-token'

[[seedbox]]
name = "nas"
enabled = true
url = "nas"
type = "rclone"
directory = "/home/uploader/data"
torrent_client = "qbittorrent+http://admin:qb-secret@10.0.0.2:8080"
label = "gravlax"
add_paused = true

[upload.compression]
compress_spectrals = false
use_upc_as_catno = false

[upload.formatting]
file_template = "{tracknumber}. {artist} - {title}"
`

// pass is `rclone obscure seedbox-secret`
const RCLONE_CONF = `
[nas]
type = sftp
host = seedbox.example.com
user = uploader
port = 2222
pass = YiE5RmsxWQF44AKrGcvL1w0XS0kE5fuGZYgWE7Na
`

let dir = ''
let tomlPath = ''
let rcloneConfPath = ''
const originalRcloneConfig = process.env['RCLONE_CONFIG']

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'gravlax-salmon-'))
  tomlPath = join(dir, 'config.toml')
  rcloneConfPath = join(dir, 'rclone.conf')
  await writeFile(tomlPath, CONFIG_TOML, 'utf8')
  await writeFile(rcloneConfPath, RCLONE_CONF, 'utf8')
  process.env['RCLONE_CONFIG'] = rcloneConfPath
})

afterEach(() => {
  if (originalRcloneConfig === undefined) delete process.env['RCLONE_CONFIG']
  else process.env['RCLONE_CONFIG'] = originalRcloneConfig
})

describe('readSalmonImportSources', () => {
  it('reads a config.toml and the rclone.conf its seedbox points at', async () => {
    const result = await readSalmonImportSources({ tomlPath })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.rclone).toMatchObject({ path: rcloneConfPath })

    const plan = buildSalmonImportPlan(result.input, defaultConfig())
    const values = Object.fromEntries(plan.rows.map((row) => [row.id, row.value]))

    expect(values).toMatchObject({
      'directories.seeding': '/srv/seeding',
      'directories.torrents': '/srv/torrents',
      'imageHosts.imgbb.apiKey': 'imgbb-secret',
      'imageHosts.imgbb.enabled': true,
      'spectral.imageHost': 'imgbb',
      'spectral.defaultSpectralIds': 'All',
      'spectral.compress': false,
      'trackers.redacted.sessionCookie': 'red-session-cookie',
      'trackers.redacted.apiKey': 'red-api-token',
      'trackers.redacted.coverImageHost': 'imgbb',
      'torrentClient.url': 'http://10.0.0.2:8080',
      'torrentClient.username': 'admin',
      'torrentClient.password': 'qb-secret',
      'torrentClient.category': 'gravlax',
      'torrentClient.startPaused': true,
      'transfer.host': 'seedbox.example.com',
      'transfer.username': 'uploader',
      'transfer.port': 2222,
      'transfer.remotePath': '/home/uploader/data',
      'workflow.useUpcAsCatNo': false,
      'naming.trackFileTemplate': '{trackNumber}. {artist} - {title}'
    })
    // The obscured rclone password comes back as plaintext.
    expect(values['transfer.password']).toBe('seedbox-secret')
    expect(plan.rcloneError).toBeUndefined()
  })

  it('reports a missing rclone.conf without failing the whole import', async () => {
    delete process.env['RCLONE_CONFIG']
    const result = await readSalmonImportSources({
      tomlPath,
      rcloneConfPath: join(dir, 'absent.conf')
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    const plan = buildSalmonImportPlan(result.input, defaultConfig())
    expect(plan.rcloneError).toContain('absent.conf')
    expect(plan.rows.some((row) => row.section === 'transfer')).toBe(false)
    // The rest of the file still imports.
    expect(plan.rows.some((row) => row.id === 'directories.seeding')).toBe(true)
  })

  it('does not look for rclone.conf when no seedbox uses rclone', async () => {
    const localOnly = join(dir, 'local.toml')
    await writeFile(localOnly, "[[seedbox]]\ntype = 'local'\ndirectory = '/srv/data'\n", 'utf8')

    const result = await readSalmonImportSources({ tomlPath: localOnly })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.input.rclone).toBeUndefined()
  })

  it('fails cleanly when the file does not exist', async () => {
    const result = await readSalmonImportSources({ tomlPath: join(dir, 'nope.toml') })
    expect(result).toMatchObject({ ok: false })
  })
})
