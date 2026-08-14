import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '@shared/types/config'
import { defaultConfig } from '@main/core/config/defaults'
import { artistRoleToImportance } from '@shared/upload/artists'
import {
  beginSubmit,
  buildUploadSnapshot,
  emptyUpload,
  ensureUploadReport,
  failUploadReport,
  fingerprintUploadInputs,
  finishSubmit,
  genresToTags,
  hostCoverImageForSubmit,
  parseYear,
  patchSubmission,
  resolveCatalogueNumber,
  resolveCoverImage,
  resumeGroupSearch,
  resumeSubmit,
  setGroupSearch,
  setSpectralBbcode,
  updateUploadReport,
  uploadArtistsFromRelease
} from '../upload'
import { SPECTRAL_PLACEHOLDER } from '@main/core/tools/upload/descriptions'
import type { UploadSubmission } from '@shared/types'
import { emptyGroupSearch } from '../groupSearch'
import { newState } from '../state'
import { planSubmissions } from '@main/services/uploadSubmit'
import { seedFormatsFromUpload } from '@main/services/seedService'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
const TEST_VERSION = 'test'

function cfgWithTrackers(enabled: Array<'redacted' | 'orpheus'>): Config {
  const cfg = structuredClone(defaultConfig())
  cfg.trackers.redacted.enabled = enabled.includes('redacted')
  cfg.trackers.redacted.siteUrl = 'https://redacted.example'
  cfg.trackers.redacted.announceUrl = 'https://flacsfor.me'
  cfg.trackers.redacted.apiKey = 'key'
  cfg.trackers.orpheus.enabled = enabled.includes('orpheus')
  cfg.trackers.orpheus.siteUrl = 'https://orpheus.example'
  cfg.trackers.orpheus.announceUrl = 'https://home.opsfet.ch'
  cfg.trackers.orpheus.apiKey = 'key'
  return cfg
}

function cfgWithCoverHost(): Config {
  const cfg = cfgWithTrackers(['redacted'])
  cfg.imageHosts.imgbb.enabled = true
  cfg.imageHosts.imgbb.apiKey = 'imgbb-key'
  cfg.trackers.redacted.coverImageHost = 'imgbb'
  return cfg
}

describe('upload helpers', () => {
  it('maps artist roles to Gazelle importance', () => {
    expect(artistRoleToImportance('main')).toBe(1)
    expect(artistRoleToImportance('dj/compiler')).toBe(6)
    expect(artistRoleToImportance('arranger')).toBe(8)
  })

  it('formats genres as tags', () => {
    expect(genresToTags(['Electronic', ' Ambient '])).toBe('electronic, ambient')
  })

  it('parses years', () => {
    expect(parseYear('2020')).toBe(2020)
    expect(parseYear('')).toBeUndefined()
  })

  it('builds upload artists from release', () => {
    expect(
      uploadArtistsFromRelease({
        artists: [
          { name: 'A', role: 'main' },
          { name: 'B', role: 'guest' },
          { name: '  ', role: 'main' }
        ]
      })
    ).toEqual([
      { name: 'A', importance: 1 },
      { name: 'B', importance: 2 }
    ])
  })

  it('uses UPC as catalogue number when CatNo is missing and toggle is on', () => {
    const cfg = defaultConfig()
    expect(resolveCatalogueNumber({ upc: '602567971092' }, cfg)).toBe('602567971092')
    expect(resolveCatalogueNumber({ catNo: '6797109', upc: '602567971092' }, cfg)).toBe('6797109')
    cfg.workflow.useUpcAsCatNo = false
    expect(resolveCatalogueNumber({ upc: '602567971092' }, cfg)).toBe('')
  })

  it('includes the running app version in the upload fingerprint', () => {
    const state = newState()
    const cfg = cfgWithTrackers([])

    expect(fingerprintUploadInputs(state, cfg, '1.0.0')).not.toBe(
      fingerprintUploadInputs(state, cfg, '2.0.0')
    )
  })
})

describe('multi-format upload', () => {
  it('builds and plans FLAC, MP3 320, and MP3 V0 as three uploads', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-formats-'))
    try {
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
            outputPath: path.join(dir, '..', 'Album [MP3 320]')
          },
          {
            optionId: 'transcode-V0',
            status: 'succeeded',
            outputPath: path.join(dir, '..', 'Album [MP3 V0]')
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
        path.join(dir, '..', 'Album [MP3 320]'),
        path.join(dir, '..', 'Album [MP3 V0]')
      ])
      // The site rejects a bitrate outside its own list, so V0 goes up under
      // the name Gazelle uses rather than the lame preset we transcoded with.
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
      await rm(dir, { recursive: true, force: true })
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
      for (const format of snapshot.formats ?? []) {
        expect(format.releaseDesc).toContain('[hr]Uploaded with [b]gravlax[/b] v9.8.7')
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

function submission(patch: Partial<UploadSubmission> = {}): UploadSubmission {
  return {
    id: 'redacted:source',
    trackerId: 'redacted',
    formatId: 'source',
    label: 'Redacted · FLAC',
    status: 'pending',
    ...patch
  }
}

describe('validate and submit', () => {
  it('clears a rejected submit on the next edit', () => {
    let state = newState()
    state = updateUploadReport(state, { title: 'Album' })
    state = failUploadReport(state, 'Select at least one tracker destination.')
    expect(state.upload.phase).toBe('failed')
    expect(state.upload.error).toBe('Select at least one tracker destination.')

    state = updateUploadReport(state, { selectedTrackerIds: ['redacted'] })
    expect(state.upload.phase).toBe('ready')
    expect(state.upload.error).toBeUndefined()
  })

  it('does not let an edit reset an in-flight or completed submit', () => {
    let state = beginSubmit(newState(), [submission()])
    state = updateUploadReport(state, { albumDesc: 'typed while uploading' })
    expect(state.upload.phase).toBe('submitting')
    expect(state.upload.albumDesc).toBe('typed while uploading')

    state = patchSubmission(state, 'redacted:source', { status: 'done', torrentId: 1 })
    state = finishSubmit(state)
    expect(state.upload.phase).toBe('done')

    state = updateUploadReport(state, { albumDesc: 'typed after' })
    expect(state.upload.phase).toBe('done')
  })

  it('beginSubmit carries completed rows across a retry', () => {
    let state = beginSubmit(newState(), [
      submission({ id: 'redacted:source' }),
      submission({ id: 'redacted:mp3', formatId: 'mp3' })
    ])
    state = patchSubmission(state, 'redacted:source', {
      status: 'done',
      torrentId: 7,
      groupId: 3,
      url: 'https://red/torrents.php?torrentid=7'
    })
    state = patchSubmission(state, 'redacted:mp3', {
      status: 'failed',
      error: 'boom',
      torrentPath: '/t/mp3.torrent',
      infoHash: 'abc'
    })

    state = beginSubmit(state, [
      submission({ id: 'redacted:source' }),
      submission({ id: 'redacted:mp3', formatId: 'mp3' })
    ])

    const [source, mp3] = state.upload.submissions!
    expect(source).toMatchObject({ status: 'done', torrentId: 7, groupId: 3 })
    // The retry reuses the torrent that was already written and hashed.
    expect(mp3).toMatchObject({ status: 'pending', torrentPath: '/t/mp3.torrent', infoHash: 'abc' })
    expect(mp3!.error).toBeUndefined()
  })

  it('finishSubmit leaves a partial success failed', () => {
    let state = beginSubmit(newState(), [
      submission({ id: 'a' }),
      submission({ id: 'b' })
    ])
    state = patchSubmission(state, 'a', { status: 'done' })
    state = patchSubmission(state, 'b', { status: 'failed', error: 'boom' })

    state = finishSubmit(state)
    expect(state.upload.phase).toBe('failed')
    expect(state.upload.error).toBe('1 of 2 uploads succeeded — retry the rest.')
  })

  it('finishSubmit reports a total failure plainly', () => {
    let state = beginSubmit(newState(), [submission()])
    state = patchSubmission(state, 'redacted:source', { status: 'failed', error: 'boom' })
    expect(finishSubmit(state).upload.error).toBe('No uploads succeeded.')
  })

  it('finishSubmit marks done only when every row succeeded', () => {
    let state = beginSubmit(newState(), [submission({ id: 'a' }), submission({ id: 'b' })])
    state = patchSubmission(state, 'a', { status: 'done' })
    state = patchSubmission(state, 'b', { status: 'done' })
    state = finishSubmit(state)
    expect(state.upload.phase).toBe('done')
    expect(state.upload.error).toBeUndefined()
  })
})

describe('setSpectralBbcode', () => {
  const format = (id: string, releaseDesc: string) => ({
    id,
    label: id,
    folderPath: '/w',
    format: 'FLAC',
    bitrate: 'Lossless',
    otherBitrate: '',
    vbr: false,
    releaseDesc,
    logfileNames: []
  })

  it('substitutes into the format holding the placeholder and leaves transcodes alone', () => {
    let state = updateUploadReport(newState(), {
      formats: [
        format('source', `${SPECTRAL_PLACEHOLDER}Encode Specifics: 16 bit\n`),
        format('mp3', '[b]Source:[/b] https://red/1\n')
      ]
    })
    state = setSpectralBbcode(state, '[hide=Spectrals]x[/hide]\n')

    expect(state.upload.spectralBbcode).toBe('[hide=Spectrals]x[/hide]\n')
    expect(state.upload.formats![0]!.releaseDesc).toBe(
      '[hide=Spectrals]x[/hide]\nEncode Specifics: 16 bit\n'
    )
    expect(state.upload.formats![1]!.releaseDesc).toBe('[b]Source:[/b] https://red/1\n')
  })

  it('drops the placeholder when nothing was hosted', () => {
    let state = updateUploadReport(newState(), {
      formats: [format('source', `${SPECTRAL_PLACEHOLDER}rest`)]
    })
    state = setSpectralBbcode(state, '')
    expect(state.upload.formats![0]!.releaseDesc).toBe('rest')
  })
})

describe('resumeSubmit', () => {
  it('flags an interrupted submit rather than offering a silent retry', () => {
    let state = beginSubmit(newState(), [
      submission({ id: 'a' }),
      submission({ id: 'b' }),
      submission({ id: 'c' })
    ])
    state = patchSubmission(state, 'a', { status: 'done', torrentId: 1 })
    state = patchSubmission(state, 'b', { status: 'running' })

    state = resumeSubmit(state)

    expect(state.upload.phase).toBe('failed')
    expect(state.upload.error).toContain('interrupted')
    const [a, b, c] = state.upload.submissions!
    expect(a).toMatchObject({ status: 'done', torrentId: 1 })
    expect(b!.status).toBe('failed')
    expect(b!.error).toContain('state unknown')
    expect(c!.status).toBe('failed')
    expect(c!.error).toBe('Not attempted.')
  })

  it('leaves a settled submit alone', () => {
    let state = beginSubmit(newState(), [submission()])
    state = patchSubmission(state, 'redacted:source', { status: 'done' })
    state = finishSubmit(state)
    expect(resumeSubmit(state)).toBe(state)
  })

  it('keeps enabled tracker defaults available from config helper', () => {
    const cfg = cfgWithTrackers(['redacted', 'orpheus'])
    expect(cfg.trackers.redacted.enabled).toBe(true)
    expect(cfg.trackers.orpheus.enabled).toBe(true)
  })

  it('keeps user edits when nothing upstream changed', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-group-'))
    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020',
      genres: ['electronic']
    }
    state = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    state = updateUploadReport(state, {
      groupIds: { redacted: 99 },
      albumDesc: 'hand written'
    })

    const next = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    expect(next.upload.groupIds?.redacted).toBe(99)
    expect(next.upload.albumDesc).toBe('hand written')
  })

  it('rebuilds on an upstream change, carrying selections but regenerating text', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-rebuild-'))
    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [
        { name: 'A', role: 'main' },
        { name: 'B', role: 'main' }
      ],
      groupYear: '2020',
      genres: ['electronic']
    }
    state = await ensureUploadReport(
      state,
      cfgWithTrackers(['redacted', 'orpheus']),
      TEST_VERSION
    )
    state = updateUploadReport(state, {
      groupIds: { redacted: 99 },
      selectedTrackerIds: ['redacted', 'orpheus'],
      scene: true,
      orpheusSplit: true,
      albumDesc: 'hand written'
    })

    // A tag change moves the fingerprint, so the payload must be rebuilt.
    state.tags.proposed = { ...state.tags.proposed, title: 'Album II' }
    const next = await ensureUploadReport(
      state,
      cfgWithTrackers(['redacted', 'orpheus']),
      TEST_VERSION
    )

    expect(next.upload.title).toBe('Album II')
    expect(next.upload.albumDesc).not.toBe('hand written')
    expect(next.upload.groupIds?.redacted).toBe(99)
    expect(next.upload.selectedTrackerIds).toEqual(['redacted', 'orpheus'])
    expect(next.upload.scene).toBe(true)
    expect(next.upload.orpheusSplit).toBe(true)
  })

  it('keeps the record of what already uploaded when a failed report rebuilds', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-partial-'))
    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020',
      genres: ['electronic']
    }
    state = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    // The FLAC landed and the transcode did not — the shape a partial submit
    // leaves behind.
    state = {
      ...state,
      upload: {
        ...state.upload,
        phase: 'failed',
        error: '1 of 2 uploads succeeded — retry the rest.',
        submissions: [
          submission({ status: 'done', torrentId: 6387038, torrentPath: 'flac.torrent' }),
          submission({
            id: 'redacted:transcode-V0',
            formatId: 'transcode-V0',
            status: 'failed',
            error: 'Invalid bitrate'
          })
        ]
      }
    }

    // Revisiting the step rebuilds, because a failed report is still editable.
    const next = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)

    // Forgetting this row would let the retry upload the FLAC a second time.
    const done = (next.upload.submissions ?? []).find((sub) => sub.id === 'redacted:source')
    expect(done?.status).toBe('done')
    expect(done?.torrentId).toBe(6387038)
    expect(next.upload.phase).toBe('failed')
    expect(next.upload.error).toBe('1 of 2 uploads succeeded — retry the rest.')

    // The V0 format is no longer prepared, so its row goes with it.
    expect(
      (next.upload.submissions ?? []).some((sub) => sub.formatId === 'transcode-V0')
    ).toBe(false)
  })

  it('clears a failure that never reached the tracker', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-prefail-'))
    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020',
      genres: ['electronic']
    }
    state = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    state = failUploadReport(state, 'Release type "Split" is not valid on Redacted')

    state.tags.proposed = { ...state.tags.proposed, releaseType: 'Album' }
    const next = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    expect(next.upload.phase).toBe('ready')
    expect(next.upload.error).toBeUndefined()
  })

  it('never rebuilds a submitted payload', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-submitted-'))
    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020',
      genres: ['electronic']
    }
    state = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    state = { ...state, upload: { ...state.upload, phase: 'done' } }

    state.tags.proposed = { ...state.tags.proposed, title: 'Album II' }
    const next = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    expect(next.upload.title).toBe('Album')
    expect(next.upload.phase).toBe('done')
  })

  it('clears a tracker groupId via update when choosing a new group', () => {
    let state = newState()
    state = updateUploadReport(state, { groupIds: { redacted: 12, orpheus: 34 } })
    state = updateUploadReport(state, { groupIds: { redacted: null, orpheus: 34 } })
    expect(state.upload.groupIds?.redacted).toBeNull()
    expect(state.upload.groupIds?.orpheus).toBe(34)
  })

  it('preserves groupSearch across non-dirty report rebuilds', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-group-'))
    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020',
      genres: ['electronic']
    }
    state = setGroupSearch(state, {
      status: 'done',
      queryStrings: ['A Album'],
      trackerIds: ['redacted'],
      fingerprint: 'fp',
      results: [
        {
          trackerId: 'redacted',
          groupId: 7,
          artist: 'A',
          groupName: 'Album',
          tags: [],
          url: 'https://redacted.example/torrents.php?id=7'
        }
      ],
      searchedAt: 1
    })
    state.upload = {
      ...state.upload,
      phase: 'ready',
      seededFrom: 'stale'
    }

    state = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    expect(state.upload.groupSearch?.status).toBe('done')
    expect(state.upload.groupSearch?.results).toHaveLength(1)
    expect(state.upload.groupSearch?.results?.[0]?.groupId).toBe(7)
    expect(state.upload.groupIds).toEqual({})
  })

  it('starts with an idle groupSearch snapshot', () => {
    expect(emptyUpload().groupSearch).toEqual(emptyGroupSearch())
  })

  it('demotes a resumed in-flight group search so it can run again', () => {
    let state = newState()
    state = setGroupSearch(state, {
      ...emptyGroupSearch(),
      status: 'running',
      fingerprint: 'fp'
    })
    expect(resumeGroupSearch(state).upload.groupSearch?.status).toBe('idle')
  })

  it('leaves a finished group search alone on resume', () => {
    let state = newState()
    state = setGroupSearch(state, {
      ...emptyGroupSearch(),
      status: 'done',
      fingerprint: 'fp'
    })
    expect(resumeGroupSearch(state).upload.groupSearch?.status).toBe('done')
  })
})

describe('cover image resolution', () => {
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

  it('finds Cover.jpg case-insensitively and keeps coverPath without a host', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'Cover.jpg')
    await writeFile(coverPath, JPEG)

    const result = await resolveCoverImage({
      workspacePath: dir
    })
    expect(result.coverPath).toBe(coverPath)
    expect(result.image).toBe('')
  })

  it('backfills coverPath on cached upload reports', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'Cover.jpg')
    await writeFile(coverPath, JPEG)

    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020',
      genres: ['electronic']
    }
    state.upload = {
      ...emptyUpload(),
      phase: 'ready',
      image: '',
      coverPath: '',
      seededFrom: fingerprintUploadInputs(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    }

    state = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    expect(state.upload.coverPath).toBe(coverPath)
  })

  it('preserves a previous image URL on rebuild without uploading', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    await writeFile(path.join(dir, 'cover.jpg'), JPEG)
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020',
      genres: ['electronic']
    }
    state.upload = {
      ...emptyUpload(),
      phase: 'ready',
      image: 'https://i.ibb.co/cached.jpg',
      seededFrom: 'stale'
    }

    state = await ensureUploadReport(state, cfgWithCoverHost(), TEST_VERSION)
    expect(state.upload.image).toBe('https://i.ibb.co/cached.jpg')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('uploads cover to the image host on submit', async () => {
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

    const result = await hostCoverImageForSubmit(state, cfgWithCoverHost())
    expect(result).toEqual({ image: 'https://i.ibb.co/cover.jpg' })
  })

  it('shows the rejection returned by the redacted image host', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-'))
    const coverPath = path.join(dir, 'cover.jpg')
    await writeFile(coverPath, JPEG)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          { status: 'failure', error: 'image dimensions are too small' },
          { status: 400 }
        )
      )
    )

    const cfg = cfgWithTrackers(['redacted'])
    cfg.imageHosts.redacted.enabled = true
    cfg.trackers.redacted.coverImageHost = 'redacted'
    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted'],
      coverPath,
      image: ''
    }

    const result = await hostCoverImageForSubmit(state, cfg)
    expect(result).toEqual({
      image: '',
      error: 'RED rejected the image: image dimensions are too small'
    })
  })

  it('skips cover host upload on submit when image URL already set', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const state = newState()
    state.upload = {
      ...emptyUpload(),
      selectedTrackerIds: ['redacted'],
      coverPath: '/tmp/cover.jpg',
      image: 'https://example.com/manual.jpg'
    }

    const result = await hostCoverImageForSubmit(state, cfgWithCoverHost())
    expect(result).toEqual({ image: 'https://example.com/manual.jpg' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('skips cover host upload on submit when all destinations use existing groups', async () => {
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

    const result = await hostCoverImageForSubmit(state, cfgWithCoverHost())
    expect(result).toEqual({ image: '' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
