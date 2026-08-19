import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadFormatPayload, UploadSnapshot, UploadSubmission } from '@shared/types'
import { defaultConfig } from '@main/core/config/defaults'
import { SOURCE_TORRENT_PLACEHOLDER } from '@main/core/tools/upload/descriptions'
import { buildTrackerUploadData } from '@main/core/tools/upload/payload'
import { planSubmissions, runSubmissions } from '@main/services/uploadSubmit'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async () => undefined),
  createTorrent: vi.fn(),
  trackerUpload: vi.fn(),
  writeTorrentFile: vi.fn(async (_meta: unknown, _torrentPath: string) => undefined),
  reportLossyMaster: vi.fn(
    async (_torrentId: number, _comment: string, _media: string) => undefined
  ),
  buildTrackerUploadData: vi.fn(() => ({}))
}))

vi.mock('@main/core/tools/trackers', () => ({
  createTrackers: vi.fn(() => [
    {
      id: 'redacted',
      client: {
        announce: 'https://announce.example/secret',
        authenticate: mocks.authenticate,
        torrentUrl: (torrentId: number) =>
          `https://redacted.example/torrents.php?torrentid=${torrentId}`
      },
      upload: mocks.trackerUpload,
      reportLossyMaster: mocks.reportLossyMaster
    }
  ])
}))

vi.mock('@main/core/tools/torrent/createTorrent', () => ({
  createTorrent: mocks.createTorrent,
  torrentFileName: (folderPath: string, source: string) =>
    `${folderPath.split(/[\\/]/).pop() ?? folderPath} - ${source}.torrent`,
  withComment: (meta: unknown) => meta,
  writeTorrentFile: mocks.writeTorrentFile
}))

vi.mock('@main/core/tools/upload/payload', () => ({
  buildTrackerUploadData: mocks.buildTrackerUploadData,
  collectLogFiles: vi.fn(async () => [])
}))

function format(
  id: string,
  label: string,
  folderPath: string,
  fileFormat: 'FLAC' | 'MP3',
  bitrate: string,
  releaseDesc = 'desc'
): UploadFormatPayload {
  return {
    id,
    label,
    folderPath,
    format: fileFormat,
    bitrate,
    otherBitrate: '',
    vbr: bitrate === 'V0',
    releaseDesc,
    logfileNames: []
  }
}

function transcodeDesc(): string {
  return `[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}\n[b]Transcode process:[/b] [code]x[/code]\n`
}

async function submit(
  upload: UploadSnapshot,
  extras: Partial<Parameters<typeof runSubmissions>[0]> = {}
): Promise<{
  patches: Map<string, Partial<UploadSubmission>>
  successful: UploadSubmission[]
}> {
  const submissions = extras.submissions ?? planSubmissions(upload)
  const patches = new Map<string, Partial<UploadSubmission>>()
  const successful: UploadSubmission[] = []
  const cfg = extras.cfg ?? defaultConfig()
  if (!extras.cfg) cfg.directories.torrents = '/torrents'

  await runSubmissions({
    cfg,
    upload,
    submissions,
    workspacePath: '/workspace/Album [FLAC]',
    lossyMaster: false,
    lossyComment: '',
    sourceUrl: '',
    spectralBbcode: '',
    fresh: () => true,
    onPatch: (id, patch) => patches.set(id, { ...patches.get(id), ...patch }),
    onCommit: async () => undefined,
    onSuccess: async (submission) => {
      successful.push(submission)
    },
    onGroupId: () => undefined,
    ...extras
  })

  return { patches, successful }
}

describe('multi-format submission', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createTorrent.mockImplementation(async ({ folderPath }: { folderPath: string }) => ({
      data: new Uint8Array([1, 2, 3]),
      meta: { info: { name: folderPath } },
      infoHash: `hash:${path.basename(folderPath)}`
    }))
    mocks.trackerUpload.mockImplementation(async () => ({
      torrentId: mocks.trackerUpload.mock.calls.length,
      groupId: 88
    }))
  })

  it('creates and uploads one torrent for FLAC, MP3 320, and MP3 V0', async () => {
    const formats = [
      format('source', 'FLAC Lossless', '/workspace/Album [FLAC]', 'FLAC', 'Lossless'),
      format('transcode-320', 'MP3 320', '/workspace/Album [MP3 320]', 'MP3', '320'),
      format('transcode-V0', 'MP3 V0', '/workspace/Album [MP3 V0]', 'MP3', 'V0')
    ]
    const upload: UploadSnapshot = {
      selectedTrackerIds: ['redacted'],
      formats,
      groupIds: {}
    }

    const { patches, successful } = await submit(upload)

    expect(mocks.createTorrent.mock.calls.map(([options]) => options.folderPath)).toEqual(
      formats.map((item) => item.folderPath)
    )
    expect(mocks.trackerUpload).toHaveBeenCalledTimes(3)
    expect(
      mocks.writeTorrentFile.mock.calls
        .map(([, torrentPath]) => torrentPath)
        .filter((torrentPath, index, all) => all.indexOf(torrentPath) === index)
    ).toEqual([
      '/torrents/Album [FLAC] - RED.torrent',
      '/torrents/Album [MP3 320] - RED.torrent',
      '/torrents/Album [MP3 V0] - RED.torrent'
    ])
    expect([...patches.values()].filter((patch) => patch.status === 'done')).toHaveLength(3)
    expect(successful.map((submission) => submission.formatId)).toEqual(formats.map((item) => item.id))
  })

  it('substitutes the source FLAC torrent URL into transcode descriptions', async () => {
    const upload: UploadSnapshot = {
      selectedTrackerIds: ['redacted'],
      formats: [
        format('source', 'FLAC Lossless', '/workspace/Album [FLAC]', 'FLAC', 'Lossless'),
        format(
          'transcode-320',
          'MP3 320',
          '/workspace/Album [MP3 320]',
          'MP3',
          '320',
          transcodeDesc()
        )
      ],
      groupIds: {}
    }

    await submit(upload)

    const sourceUrl = 'https://redacted.example/torrents.php?torrentid=1'
    expect(vi.mocked(buildTrackerUploadData).mock.calls.map(([input]) => input.format.releaseDesc)).toEqual(
      ['desc', `[b]Source:[/b] ${sourceUrl}\n[b]Transcode process:[/b] [code]x[/code]\n`]
    )
    expect(upload.formats?.[1]?.releaseDesc).toContain(SOURCE_TORRENT_PLACEHOLDER)
  })

  it('uses an already-uploaded source torrent URL on retry', async () => {
    const upload: UploadSnapshot = {
      selectedTrackerIds: ['redacted'],
      formats: [
        format('source', 'FLAC Lossless', '/workspace/Album [FLAC]', 'FLAC', 'Lossless'),
        format(
          'transcode-320',
          'MP3 320',
          '/workspace/Album [MP3 320]',
          'MP3',
          '320',
          transcodeDesc()
        )
      ],
      groupIds: {}
    }
    const sourceUrl = 'https://redacted.example/torrents.php?torrentid=9'
    const submissions: UploadSubmission[] = [
      {
        id: 'redacted:source',
        trackerId: 'redacted',
        formatId: 'source',
        label: 'Redacted · FLAC Lossless',
        status: 'done',
        url: sourceUrl
      },
      {
        id: 'redacted:transcode-320',
        trackerId: 'redacted',
        formatId: 'transcode-320',
        label: 'Redacted · MP3 320',
        status: 'pending'
      }
    ]

    await submit(upload, { submissions })

    expect(mocks.trackerUpload).toHaveBeenCalledTimes(1)
    expect(vi.mocked(buildTrackerUploadData).mock.calls[0]?.[0].format.releaseDesc).toBe(
      `[b]Source:[/b] ${sourceUrl}\n[b]Transcode process:[/b] [code]x[/code]\n`
    )
  })

  it('fails a transcode when the source torrent URL is missing', async () => {
    const upload: UploadSnapshot = {
      selectedTrackerIds: ['redacted'],
      formats: [
        format(
          'transcode-320',
          'MP3 320',
          '/workspace/Album [MP3 320]',
          'MP3',
          '320',
          transcodeDesc()
        )
      ],
      groupIds: {}
    }

    const { patches } = await submit(upload)

    expect(mocks.trackerUpload).not.toHaveBeenCalled()
    expect(patches.get('redacted:transcode-320')).toMatchObject({
      status: 'failed',
      error: 'Source FLAC torrent URL is missing.'
    })
  })

  it('points the transcode lossy report at the source FLAC torrent', async () => {
    const upload: UploadSnapshot = {
      selectedTrackerIds: ['redacted'],
      formats: [
        format('source', 'FLAC Lossless', '/workspace/Album [FLAC]', 'FLAC', 'Lossless'),
        format(
          'transcode-320',
          'MP3 320',
          '/workspace/Album [MP3 320]',
          'MP3',
          '320',
          transcodeDesc()
        )
      ],
      groupIds: {},
      media: 'WEB'
    }

    await submit(upload, {
      lossyMaster: true,
      lossyComment: 'Soft clipped',
      sourceUrl: 'https://www.discogs.com/release/1',
      spectralBbcode: '[hide=Spectrals]x[/hide]\n'
    })

    const sourceUrl = 'https://redacted.example/torrents.php?torrentid=1'
    expect(mocks.reportLossyMaster.mock.calls.map((call) => call[1])).toEqual([
      'Soft clipped\n\n[hide=Spectrals]x[/hide]\n',
      `Transcode of ${sourceUrl}\n[hide=Lossy comment of original torrent]Soft clipped\n\n[hide=Spectrals]x[/hide][/hide]\n`
    ])
  })
})
