import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadFormatPayload, UploadSnapshot, UploadSubmission } from '@shared/types'
import { defaultConfig } from '@main/core/config/defaults'
import { planSubmissions, runSubmissions } from '@main/services/uploadSubmit'

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async () => undefined),
  createTorrent: vi.fn(),
  trackerUpload: vi.fn(),
  writeTorrentFile: vi.fn(async (_meta: unknown, _torrentPath: string) => undefined)
}))

vi.mock('@main/core/tools/trackers', () => ({
  createTrackers: vi.fn(() => [
    {
      id: 'redacted',
      client: {
        announce: 'https://announce.example/secret',
        authenticate: mocks.authenticate,
        torrentUrl: (torrentId: number) => `https://redacted.example/torrents.php?torrentid=${torrentId}`
      },
      upload: mocks.trackerUpload,
      reportLossyMaster: vi.fn(async () => undefined)
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
  buildTrackerUploadData: vi.fn(() => ({})),
  collectLogFiles: vi.fn(async () => [])
}))

function format(
  id: string,
  label: string,
  folderPath: string,
  fileFormat: 'FLAC' | 'MP3',
  bitrate: string
): UploadFormatPayload {
  return {
    id,
    label,
    folderPath,
    format: fileFormat,
    bitrate,
    otherBitrate: '',
    vbr: bitrate === 'V0',
    releaseDesc: 'desc',
    logfileNames: []
  }
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
    const submissions = planSubmissions(upload)
    const patches = new Map<string, Partial<UploadSubmission>>()
    const successful: UploadSubmission[] = []
    const cfg = defaultConfig()
    cfg.directories.torrents = '/torrents'

    await runSubmissions({
      cfg,
      upload,
      submissions,
      workspacePath: '/workspace/Album [FLAC]',
      version: 'test',
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
      onGroupId: () => undefined
    })

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
})
