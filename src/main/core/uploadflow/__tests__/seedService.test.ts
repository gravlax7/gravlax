import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '@shared/types/config'
import type { SeedFormatInput } from '@shared/types'
import { defaultConfig } from '@main/core/config/defaults'
import { buildInitialSeed, runSeed } from '@main/services/seedService'

vi.mock('@main/core/tools/transfer', () => ({
  uploadFolderViaSftp: vi.fn(async () => undefined),
  copyFolderForSeeding: vi.fn(async (src: string, dest: string) => ({
    destination: join(dest, 'Album'),
    hardlinked: true,
    bytesTotal: 100,
    fileCount: 2
  })),
  createRateMeter: vi.fn(() => ({ sample: () => 0, bytesPerSecond: () => 0 }))
}))

const addTorrent = vi.fn(async () => undefined)
const getTorrent = vi.fn(async () => ({
  hash: 'abc',
  name: 'Album [FLAC]',
  state: 'uploading',
  savePath: '/seed',
  category: 'music'
}))

vi.mock('@main/core/tools/torrentClient', async () => {
  const actual = await vi.importActual<typeof import('@main/core/tools/torrentClient')>(
    '@main/core/tools/torrentClient'
  )
  return {
    ...actual,
    createQBittorrentClient: vi.fn(() => ({
      login: vi.fn(async () => undefined),
      addTorrent,
      getTorrent,
      version: vi.fn(async () => 'v5')
    }))
  }
})

let root = ''
let torrentPath = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-seed-'))
  torrentPath = join(root, 'album.torrent')
  await writeFile(torrentPath, Buffer.from([1, 2, 3]))
  addTorrent.mockClear()
  getTorrent.mockReset()
  getTorrent.mockResolvedValue({
    hash: 'abc',
    name: 'Album [FLAC]',
    state: 'uploading',
    savePath: '/seed',
    category: 'music'
  })
  vi.mocked((await import('@main/core/tools/transfer')).copyFolderForSeeding).mockClear()
})

afterEach(async () => {
  vi.useRealTimers()
  await rm(root, { recursive: true, force: true })
  vi.mocked((await import('@main/core/tools/transfer')).uploadFolderViaSftp).mockClear()
})

function seedboxConfig(): Config {
  const cfg = defaultConfig()
  cfg.transfer.enabled = true
  cfg.transfer.host = 'seed.example'
  cfg.transfer.username = 'u'
  cfg.transfer.password = 'p'
  cfg.transfer.remotePath = '/downloads'
  cfg.torrentClient.enabled = true
  cfg.torrentClient.url = 'http://127.0.0.1:8080'
  cfg.torrentClient.username = 'admin'
  cfg.torrentClient.password = 'secret'
  return cfg
}

function format(patch: Partial<SeedFormatInput> = {}): SeedFormatInput {
  return {
    id: 'flac',
    label: 'FLAC',
    folderPath: '/tmp/Album [FLAC]',
    torrents: [{ trackerId: 'redacted', torrentPath, infoHash: 'abc' }],
    ...patch
  }
}

describe('buildInitialSeed', () => {
  it('queues transfers first, then one inject per tracker per format', () => {
    const cfg = seedboxConfig()
    const initial = buildInitialSeed(cfg, [
      format({
        torrents: [
          { trackerId: 'redacted', torrentPath, infoHash: 'a' },
          { trackerId: 'orpheus', torrentPath, infoHash: 'b' }
        ]
      }),
      format({ id: 'mp3', label: 'MP3', torrents: [{ trackerId: 'redacted', torrentPath, infoHash: 'c' }] })
    ])

    expect(initial.tasks.map((t) => t.id)).toEqual([
      'transfer:flac',
      'transfer:mp3',
      'inject:flac:redacted',
      'inject:flac:orpheus',
      'inject:mp3:redacted'
    ])
    expect(initial.tasks[2]?.label).toBe('Inject FLAC (RED)')
    expect(initial.tasks[3]?.label).toBe('Inject FLAC (OPS)')
    expect(initial.tasks[3]?.trackerId).toBe('orpheus')
  })

  it('uses a copy task when the seedbox is off and a seeding folder is set', () => {
    const cfg = defaultConfig()
    cfg.directories.seeding = '/seed'
    cfg.torrentClient.enabled = true
    const initial = buildInitialSeed(cfg, [format()])
    expect(initial.tasks.map((t) => `${t.kind}:${t.id}`)).toEqual([
      'copy:copy:flac',
      'inject:inject:flac:redacted'
    ])
  })

  it('carries completed tasks across a retry', () => {
    const cfg = seedboxConfig()
    const previous = buildInitialSeed(cfg, [format()]).tasks.map((task) =>
      task.kind === 'transfer'
        ? { ...task, status: 'done' as const, bytesTotal: 999, detail: 'Album [FLAC]' }
        : { ...task, status: 'failed' as const }
    )

    const retried = buildInitialSeed(cfg, [format()], previous)
    expect(retried.tasks[0]).toMatchObject({ status: 'done', bytesTotal: 999 })
    expect(retried.tasks[1]?.status).toBe('pending')
  })
})

describe('runSeed', () => {
  it('transfers then injects, verifying against the client', async () => {
    const result = await runSeed({ cfg: seedboxConfig(), formats: [format()] })

    expect(result.phase).toBe('done')
    expect(result.tasks.find((t) => t.id === 'transfer:flac')).toMatchObject({
      status: 'done',
      detail: '/downloads/Album [FLAC]'
    })
    const inject = result.tasks.find((t) => t.id === 'inject:flac:redacted')
    expect(inject?.status).toBe('done')
    expect(inject?.detail).toBe('Album [FLAC] · uploading · /seed')
    expect(getTorrent).toHaveBeenCalledWith('abc')
  })

  it('records complete SFTP totals when the last progress update is throttled', async () => {
    const { uploadFolderViaSftp } = await import('@main/core/tools/transfer')
    vi.mocked(uploadFolderViaSftp).mockImplementationOnce(async (_cfg, options) => {
      options.onProgress?.({
        bytesTransferred: 250,
        bytesTotal: 300,
        filesTransferred: 12,
        filesTotal: 17,
        currentFile: '12.flac'
      })
      options.onProgress?.({
        bytesTransferred: 300,
        bytesTotal: 300,
        filesTransferred: 17,
        filesTotal: 17,
        currentFile: 'cover.jpg'
      })
    })

    const result = await runSeed({ cfg: seedboxConfig(), formats: [format()] })

    expect(result.tasks.find((task) => task.id === 'transfer:flac')).toMatchObject({
      status: 'done',
      bytesTransferred: 300,
      bytesTotal: 300,
      filesTransferred: 17,
      filesTotal: 17
    })
  })

  it('fails the inject when the client does not actually hold the torrent', async () => {
    vi.useFakeTimers()
    getTorrent.mockResolvedValue(null as never)
    const pending = runSeed({ cfg: seedboxConfig(), formats: [format()] })
    await vi.waitFor(() => expect(getTorrent).toHaveBeenCalledTimes(1))
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.phase).toBe('failed')
    const inject = result.tasks.find((t) => t.id === 'inject:flac:redacted')
    expect(inject?.status).toBe('failed')
    expect(inject?.detail).toMatch(/does not have the torrent/i)
  })

  it('waits for qBittorrent to finish adding the torrent', async () => {
    vi.useFakeTimers()
    getTorrent
      .mockResolvedValueOnce(null as never)
      .mockResolvedValueOnce({
        hash: 'abc',
        name: 'Album [FLAC]',
        state: 'uploading',
        savePath: '/seed',
        category: 'music'
      })

    const pending = runSeed({ cfg: seedboxConfig(), formats: [format()] })
    await vi.waitFor(() => expect(getTorrent).toHaveBeenCalledTimes(1))
    await vi.runAllTimersAsync()
    const result = await pending

    expect(result.tasks.find((t) => t.id === 'inject:flac:redacted')).toMatchObject({
      status: 'done',
      detail: 'Album [FLAC] · uploading · /seed'
    })
    expect(getTorrent).toHaveBeenCalledTimes(2)
  })

  it('records a hardlinked copy without a rate', async () => {
    const cfg = defaultConfig()
    cfg.directories.seeding = '/seed'
    cfg.torrentClient.enabled = true
    cfg.torrentClient.url = 'http://127.0.0.1:8080'

    const result = await runSeed({ cfg, formats: [format()] })

    const copy = result.tasks.find((t) => t.id === 'copy:flac')
    expect(copy).toMatchObject({
      status: 'done',
      hardlinked: true,
      bytesTotal: 100,
      filesTotal: 2,
      detail: '/seed/Album'
    })
    expect(copy?.bytesPerSecond).toBeUndefined()
  })

  it('copies FLAC, MP3 320, and MP3 V0 as three separate folders', async () => {
    const cfg = defaultConfig()
    cfg.directories.seeding = '/seed'
    const { copyFolderForSeeding } = await import('@main/core/tools/transfer')
    const formats = [
      format({ id: 'source', label: 'FLAC', folderPath: '/tmp/Album [FLAC]' }),
      format({ id: 'transcode-320', label: 'MP3 320', folderPath: '/tmp/Album [MP3 320]' }),
      format({ id: 'transcode-V0', label: 'MP3 V0', folderPath: '/tmp/Album [MP3 V0]' })
    ]

    const result = await runSeed({ cfg, formats })

    expect(vi.mocked(copyFolderForSeeding).mock.calls.map(([source]) => source)).toEqual(
      formats.map((item) => item.folderPath)
    )
    expect(result.tasks.map((task) => task.id)).toEqual([
      'copy:source',
      'copy:transcode-320',
      'copy:transcode-V0'
    ])
    expect(result.phase).toBe('done')
  })

  it('skips injection for a format whose transfer failed', async () => {
    const { uploadFolderViaSftp } = await import('@main/core/tools/transfer')
    vi.mocked(uploadFolderViaSftp).mockImplementationOnce(async () => {
      throw new Error('connection reset')
    })

    const result = await runSeed({ cfg: seedboxConfig(), formats: [format()] })

    expect(result.phase).toBe('failed')
    expect(result.tasks.find((t) => t.id === 'transfer:flac')?.status).toBe('failed')
    // Without this gate the client would be pointed at a half-written folder
    // and would start re-downloading the release we just uploaded.
    const inject = result.tasks.find((t) => t.id === 'inject:flac:redacted')
    expect(inject?.status).toBe('skipped')
    expect(inject?.detail).toMatch(/transfer did not complete/i)
    expect(addTorrent).not.toHaveBeenCalled()
  })

  it('does not repeat a transfer that already completed', async () => {
    const { uploadFolderViaSftp } = await import('@main/core/tools/transfer')
    const cfg = seedboxConfig()
    const previous = buildInitialSeed(cfg, [format()]).tasks.map((task) =>
      task.kind === 'transfer' ? { ...task, status: 'done' as const } : task
    )

    await runSeed({ cfg, formats: [format()], previousTasks: previous })

    expect(uploadFolderViaSftp).not.toHaveBeenCalled()
    expect(addTorrent).toHaveBeenCalledTimes(1)
  })

  it('fails the inject when no save path can be resolved', async () => {
    const cfg = defaultConfig()
    cfg.directories.seeding = '/seed'
    cfg.torrentClient.enabled = true
    cfg.torrentClient.savePath = ''
    // Seeding folder drives the copy but is cleared here, so nothing pins a path.
    const result = await runSeed({
      cfg: { ...cfg, directories: { ...cfg.directories, seeding: '' } },
      formats: [format()]
    })

    const inject = result.tasks.find((t) => t.id === 'inject:flac:redacted')
    expect(inject?.status).toBe('failed')
    expect(inject?.detail).toMatch(/seeding folder are both empty/i)
  })

  it('does nothing when the seedbox, seeding folder and torrent client are all off', async () => {
    const result = await runSeed({ cfg: defaultConfig(), formats: [format()] })
    expect(result.tasks).toHaveLength(0)
    expect(result.phase).toBe('done')
  })
})
