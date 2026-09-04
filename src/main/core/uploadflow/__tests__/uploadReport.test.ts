import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artistRoleToImportance } from '@shared/upload/artists'
import {
  buildUploadSnapshot,
  fingerprintUploadInputs,
  genresToTags,
  hostCoverImagesForSubmit,
  resolveCoverImage,
  resolveUploadTags
} from '../uploadReport'
import { emptyUpload, ensureUploadReport } from '../upload'
import { newState } from '../state'
import { SOURCE_TORRENT_PLACEHOLDER } from '@main/core/tools/upload/descriptions'
import { planSubmissions } from '@main/services/uploadSubmit'
import { seedFormatsFromUpload } from '@main/services/seedService'
import { ImageHostUploadError } from '@main/core/tools/imagehosts/provider'
import {
  JPEG,
  TEST_VERSION,
  cfgWithCoverHost,
  cfgWithTrackers
} from './uploadTestFixtures'

describe('upload report helpers', () => {
  it('maps artist roles to Gazelle importance', () => {
    expect(artistRoleToImportance('main')).toBe(1)
    expect(artistRoleToImportance('dj/compiler')).toBe(6)
    expect(artistRoleToImportance('arranger')).toBe(8)
  })

  it('formats genres as tags', () => {
    expect(genresToTags(['Electronic', ' Ambient '])).toBe('electronic, ambient')
  })

  it('falls back to current file genres when proposed has none', () => {
    expect(
      resolveUploadTags({
        ...newState(),
        tags: {
          current: { genres: ['Rock', 'Indie'] },
          proposed: { title: 'Album' }
        }
      })
    ).toBe('rock, indie')
  })

  it('includes the running app version in the upload fingerprint', () => {
    const state = newState()
    const cfg = cfgWithTrackers([])

    expect(fingerprintUploadInputs(state, cfg, '1.0.0')).not.toBe(
      fingerprintUploadInputs(state, cfg, '2.0.0')
    )
  })
})

describe('multi-format upload report', () => {
  it('builds and plans FLAC, MP3 320, and MP3 V0 as three uploads', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-formats-'))
    const dir = path.join(root, 'Album [FLAC]')
    const mp3320 = path.join(root, 'Album [MP3 320]')
    const mp3V0 = path.join(root, 'Album [MP3 V0]')
    try {
      await Promise.all([dir, mp3320, mp3V0].map((folder) => mkdir(folder)))
      await Promise.all([
        writeFile(path.join(dir, 'source.bin'), Buffer.alloc(1024)),
        writeFile(path.join(mp3320, '320.bin'), Buffer.alloc(2048)),
        writeFile(path.join(mp3V0, 'v0.bin'), Buffer.alloc(3072))
      ])
      const state = newState()
      state.draft.workspacePath = dir
      state.draft.sourceMedia = 'WEB'
      state.tags.proposed = {
        title: 'Album',
        artists: [{ name: 'A', role: 'main' }],
        groupYear: '2020',
        year: '2020',
        releaseType: 'Album',
        genres: ['electronic']
      }
      state.transcode = {
        phase: 'done',
        inspection: {
          encoding: 'Lossless',
          sampleRate: 44100,
          trackCount: 1,
          hybrid: false,
          blockers: [],
          options: [
            {
              id: 'transcode-320',
              name: 'MP3 320',
              action: 'transcode',
              bitrate: '320',
              outputFolderName: 'Album [MP3 320]'
            },
            {
              id: 'transcode-V0',
              name: 'MP3 V0',
              action: 'transcode',
              bitrate: 'V0',
              outputFolderName: 'Album [MP3 V0]'
            }
          ]
        },
        selectedOptionIds: ['transcode-320', 'transcode-V0'],
        jobs: [
          {
            optionId: 'transcode-320',
            status: 'succeeded',
            outputPath: mp3320
          },
          {
            optionId: 'transcode-V0',
            status: 'succeeded',
            outputPath: mp3V0
          }
        ]
      }

      const snapshot = await buildUploadSnapshot(state, cfgWithTrackers(['redacted']), {
        version: TEST_VERSION
      })
      expect(snapshot.formats?.map((format) => format.id)).toEqual([
        'source',
        'transcode-320',
        'transcode-V0'
      ])
      expect(snapshot.formats?.map((format) => format.folderPath)).toEqual([
        dir,
        mp3320,
        mp3V0
      ])
      expect(snapshot.formats?.map((format) => format.sizeBytes)).toEqual([1024, 2048, 3072])
      expect(snapshot.formats?.map((format) => format.bitrate)).toEqual([
        'Lossless',
        '320',
        'V0 (VBR)'
      ])
      expect(snapshot.formats?.map((format) => format.vbr)).toEqual([false, false, true])

      const submissions = planSubmissions(snapshot)
      expect(submissions.map((submission) => submission.id)).toEqual([
        'redacted:source',
        'redacted:transcode-320',
        'redacted:transcode-V0'
      ])

      const seeded = seedFormatsFromUpload({
        ...snapshot,
        submissions: submissions.map((submission, index) => ({
          ...submission,
          status: 'done',
          torrentPath: path.join(dir, `${index}.torrent`),
          infoHash: `hash-${index}`
        }))
      })
      expect(seeded.map((format) => format.id)).toEqual([
        'source',
        'transcode-320',
        'transcode-V0'
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the running app version in every format description', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-version-'))
    try {
      const state = newState()
      state.draft.workspacePath = dir
      state.draft.sourceMedia = 'WEB'
      state.tags.proposed = { title: 'Album' }
      state.transcode = {
        phase: 'done',
        inspection: {
          encoding: '24bit Lossless',
          sampleRate: 96000,
          trackCount: 1,
          hybrid: false,
          blockers: [],
          options: [
            {
              id: 'transcode-V0',
              name: 'MP3 V0',
              action: 'transcode',
              bitrate: 'V0',
              outputFolderName: 'Album [MP3 V0]'
            },
            {
              id: 'downconvert-16-48000',
              name: '16bit 48.0 kHz',
              action: 'downconvert',
              targetBitDepth: 16,
              targetSampleRate: 48000,
              outputFolderName: 'Album [WEB FLAC]'
            }
          ]
        },
        selectedOptionIds: ['transcode-V0', 'downconvert-16-48000'],
        jobs: [
          {
            optionId: 'transcode-V0',
            status: 'succeeded',
            outputPath: path.join(dir, '..', 'Album [MP3 V0]')
          },
          {
            optionId: 'downconvert-16-48000',
            status: 'succeeded',
            outputPath: path.join(dir, '..', 'Album [WEB FLAC]')
          }
        ]
      }

      const snapshot = await buildUploadSnapshot(state, cfgWithTrackers(['redacted']), {
        version: '9.8.7'
      })

      expect(snapshot.formats).toHaveLength(3)
      expect(snapshot.formats![0]!.releaseDesc).not.toContain(SOURCE_TORRENT_PLACEHOLDER)
      expect(snapshot.formats![1]!.releaseDesc).toContain(
        `[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}`
      )
      expect(snapshot.formats![1]!.releaseDesc).not.toContain('More info')
      expect(snapshot.formats![2]!.releaseDesc).toContain(
        `[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}`
      )
      expect(snapshot.formats![2]!.releaseDesc).not.toContain('More info')
      for (const format of snapshot.formats ?? []) {
        expect(format.releaseDesc).toContain('[hr]Uploaded with [b]gravlax[/b] v9.8.7')
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('cover image report work', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('discovers local cover without uploading when building the report', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    await writeFile(path.join(dir, 'cover.jpg'), JPEG)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020',
      genres: ['electronic']
    }

    const snapshot = await buildUploadSnapshot(state, cfgWithCoverHost(), {
      version: TEST_VERSION
    })
    expect(snapshot.image).toBe('')
    expect(snapshot.coverPath).toBe(path.join(dir, 'cover.jpg'))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('copies a downloaded cover into every finished alternate format', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-formats-'))
    const source = path.join(root, 'Album [FLAC]')
    const mp3 = path.join(root, 'Album [MP3 V0]')
    const downconvert = path.join(root, 'Album [16bit FLAC]')
    try {
      await Promise.all([source, mp3, downconvert].map((folder) => mkdir(folder)))
      await Promise.all([
        writeFile(path.join(source, '01.flac'), 'source'),
        writeFile(path.join(mp3, '01.mp3'), 'mp3'),
        writeFile(path.join(downconvert, '01.flac'), 'downconvert')
      ])
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JPEG)))

      const state = newState()
      state.draft.workspacePath = source
      state.draft.sourceMedia = 'WEB'
      state.tags.proposed = { title: 'Album', cover: 'https://example.test/cover.jpg' }
      state.transcode = {
        phase: 'done',
        inspection: {
          encoding: '24bit Lossless',
          sampleRate: 96000,
          trackCount: 1,
          hybrid: false,
          blockers: [],
          options: [
            {
              id: 'transcode-V0',
              name: 'MP3 V0',
              action: 'transcode',
              bitrate: 'V0',
              outputFolderName: path.basename(mp3)
            },
            {
              id: 'downconvert-16-48000',
              name: '16bit 48.0 kHz',
              action: 'downconvert',
              targetBitDepth: 16,
              targetSampleRate: 48000,
              outputFolderName: path.basename(downconvert)
            }
          ]
        },
        selectedOptionIds: ['transcode-V0', 'downconvert-16-48000'],
        jobs: [
          { optionId: 'transcode-V0', status: 'succeeded', outputPath: mp3 },
          {
            optionId: 'downconvert-16-48000',
            status: 'succeeded',
            outputPath: downconvert
          }
        ]
      }

      const snapshot = await buildUploadSnapshot(state, cfgWithTrackers([]), {
        version: TEST_VERSION
      })

      await expect(readFile(path.join(mp3, 'cover.jpg'))).resolves.toEqual(JPEG)
      await expect(readFile(path.join(downconvert, 'cover.jpg'))).resolves.toEqual(JPEG)
      expect(snapshot.formats?.map((format) => format.sizeBytes)).toEqual([
        6 + JPEG.length,
        3 + JPEG.length,
        11 + JPEG.length
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('repairs a missing cover in a cached ready report', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-cache-'))
    const source = path.join(root, 'Album [FLAC]')
    const mp3 = path.join(root, 'Album [MP3 V0]')
    try {
      await Promise.all([source, mp3].map((folder) => mkdir(folder)))
      const coverPath = path.join(source, 'cover.jpg')
      await Promise.all([
        writeFile(path.join(source, '01.flac'), 'source'),
        writeFile(path.join(mp3, '01.mp3'), 'mp3'),
        writeFile(coverPath, JPEG)
      ])

      const cfg = cfgWithTrackers([])
      const state = newState()
      state.draft.workspacePath = source
      state.draft.sourceMedia = 'WEB'
      state.tags.proposed = { title: 'Album' }
      state.upload = {
        ...emptyUpload(),
        phase: 'ready',
        coverPath,
        formats: [
          {
            id: 'source',
            label: 'FLAC Lossless',
            folderPath: source,
            format: 'FLAC',
            bitrate: 'Lossless',
            otherBitrate: '',
            vbr: false,
            releaseDesc: '',
            logfileNames: []
          },
          {
            id: 'transcode-V0',
            label: 'MP3 V0',
            folderPath: mp3,
            format: 'MP3',
            bitrate: 'V0 (VBR)',
            otherBitrate: '',
            vbr: true,
            releaseDesc: '',
            logfileNames: []
          }
        ],
        seededFrom: fingerprintUploadInputs(state, cfg, TEST_VERSION)
      }

      const next = await ensureUploadReport(state, cfg, TEST_VERSION)

      await expect(readFile(path.join(mp3, 'cover.jpg'))).resolves.toEqual(JPEG)
      expect(next.upload.formats?.map((format) => format.sizeBytes)).toEqual([
        6 + JPEG.length,
        3 + JPEG.length
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('finds Cover.jpg case-insensitively and keeps coverPath without a host', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'Cover.jpg')
    await writeFile(coverPath, JPEG)

    const result = await resolveCoverImage({ workspacePath: dir })
    expect(result.coverPath).toBe(coverPath)
    expect(result.image).toBe('')
  })

  it('hosts a cover for one tracker on submit', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'cover.jpg')
    await writeFile(coverPath, JPEG)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ data: { url: 'https://i.ibb.co/cover.jpg' } }))
    )

    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted'],
      coverPath,
      image: ''
    }

    const result = await hostCoverImagesForSubmit(state, cfgWithCoverHost(), ['redacted'])
    expect(result).toEqual({
      hostedCoverImages: {
        redacted: { host: 'imgbb', url: 'https://i.ibb.co/cover.jpg' }
      }
    })
  })

  it('returns a tracker and host error when cover hosting fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'cover.jpg')
    await writeFile(coverPath, JPEG)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new ImageHostUploadError('Image host rejected the cover.')
      })
    )

    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted'],
      coverPath,
      image: ''
    }

    const result = await hostCoverImagesForSubmit(state, cfgWithCoverHost(), ['redacted'])
    expect(result).toEqual({
      hostedCoverImages: {},
      error: 'Failed to upload Redacted cover to imgbb. Image host rejected the cover.'
    })
  })

  it('uses one manual image URL instead of hosting', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted'],
      coverPath: '/tmp/cover.jpg',
      image: 'https://example.com/manual.jpg'
    }

    const result = await hostCoverImagesForSubmit(state, cfgWithCoverHost(), ['redacted'])
    expect(result).toEqual({ hostedCoverImages: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not host a cover for a tracker with an existing group', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted'],
      coverPath: '/tmp/cover.jpg',
      image: '',
      groupIds: { redacted: 99 }
    }

    const result = await hostCoverImagesForSubmit(state, cfgWithCoverHost(), ['redacted'])
    expect(result).toEqual({ hostedCoverImages: {} })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('hosts the cover on each tracker host', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'cover.jpg')
    await writeFile(coverPath, JPEG)
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      if (String(url).includes('upload_image')) {
        return Response.json({
          status: 'success',
          response: { url: 'https://red-image.example/cover.jpg' }
        })
      }
      return Response.json({ links: ['https://ra-image.example/cover.jpg'] })
    })
    vi.stubGlobal('fetch', fetchMock)

    const cfg = cfgWithTrackers(['redacted', 'orpheus'])
    cfg.imageHosts.redacted.enabled = true
    cfg.imageHosts.thesungod.enabled = true
    cfg.imageHosts.thesungod.apiKey = 'ra-key'
    cfg.trackers.redacted.siteUrl = 'redacted.example'
    cfg.trackers.redacted.announceUrl = 'announce.redacted.example'
    cfg.trackers.redacted.apiKey = 'red-key'
    cfg.trackers.redacted.coverImageHost = 'redacted'
    cfg.trackers.orpheus.coverImageHost = 'thesungod'
    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted', 'orpheus'],
      coverPath
    }

    const result = await hostCoverImagesForSubmit(state, cfg, ['redacted', 'orpheus'])

    expect(result).toEqual({
      hostedCoverImages: {
        redacted: { host: 'redacted', url: 'https://red-image.example/cover.jpg' },
        orpheus: { host: 'thesungod', url: 'https://ra-image.example/cover.jpg' }
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uploads once when trackers share a cover host', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'cover.jpg')
    await writeFile(coverPath, JPEG)
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { url: 'https://i.ibb.co/shared.jpg' } })
    )
    vi.stubGlobal('fetch', fetchMock)

    const cfg = cfgWithTrackers(['redacted', 'orpheus'])
    cfg.imageHosts.imgbb.enabled = true
    cfg.imageHosts.imgbb.apiKey = 'imgbb-key'
    cfg.trackers.redacted.coverImageHost = 'imgbb'
    cfg.trackers.orpheus.coverImageHost = 'imgbb'
    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted', 'orpheus'],
      coverPath
    }

    const result = await hostCoverImagesForSubmit(state, cfg, ['redacted', 'orpheus'])

    expect(result.hostedCoverImages).toEqual({
      redacted: { host: 'imgbb', url: 'https://i.ibb.co/shared.jpg' },
      orpheus: { host: 'imgbb', url: 'https://i.ibb.co/shared.jpg' }
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('reuses a saved URL only while its host matches the setting', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'cover.jpg')
    await writeFile(coverPath, JPEG)
    const fetchMock = vi.fn(async () =>
      Response.json({ data: { url: 'https://i.ibb.co/new.jpg' } })
    )
    vi.stubGlobal('fetch', fetchMock)

    const cfg = cfgWithCoverHost()
    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted'],
      coverPath,
      hostedCoverImages: {
        redacted: { host: 'imgbb', url: 'https://i.ibb.co/saved.jpg' }
      }
    }

    await expect(hostCoverImagesForSubmit(state, cfg, ['redacted'])).resolves.toEqual({
      hostedCoverImages: {
        redacted: { host: 'imgbb', url: 'https://i.ibb.co/saved.jpg' }
      }
    })
    expect(fetchMock).not.toHaveBeenCalled()

    state.upload.hostedCoverImages = {
      redacted: { host: 'thesungod', url: 'https://ra-image.example/old.jpg' }
    }
    await expect(hostCoverImagesForSubmit(state, cfg, ['redacted'])).resolves.toEqual({
      hostedCoverImages: {
        redacted: { host: 'imgbb', url: 'https://i.ibb.co/new.jpg' }
      }
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    cfg.trackers.redacted.coverImageHost = ''
    state.upload.hostedCoverImages = {
      redacted: { host: 'imgbb', url: 'https://i.ibb.co/old.jpg' }
    }
    await expect(hostCoverImagesForSubmit(state, cfg, ['redacted'])).resolves.toEqual({
      hostedCoverImages: {},
      error: 'Redacted has no cover image host selected.'
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('keeps successful hosted URLs when another host fails', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'cover.jpg')
    await writeFile(coverPath, JPEG)
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) => {
        if (String(url).includes('imgbb')) {
          return Response.json({ data: { url: 'https://i.ibb.co/saved.jpg' } })
        }
        return new Response('', { status: 500 })
      })
    )

    const cfg = cfgWithTrackers(['redacted', 'orpheus'])
    cfg.imageHosts.imgbb.enabled = true
    cfg.imageHosts.imgbb.apiKey = 'imgbb-key'
    cfg.imageHosts.thesungod.enabled = true
    cfg.imageHosts.thesungod.apiKey = 'ra-key'
    cfg.trackers.redacted.coverImageHost = 'imgbb'
    cfg.trackers.orpheus.coverImageHost = 'thesungod'
    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted', 'orpheus'],
      coverPath
    }

    await expect(
      hostCoverImagesForSubmit(state, cfg, ['redacted', 'orpheus'])
    ).resolves.toEqual({
      hostedCoverImages: {
        redacted: { host: 'imgbb', url: 'https://i.ibb.co/saved.jpg' }
      },
      error: 'Failed to upload Orpheus cover to thesungod.'
    })
  })
})
