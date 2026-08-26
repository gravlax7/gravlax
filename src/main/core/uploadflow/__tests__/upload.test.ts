import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  beginSubmit,
  emptyUpload,
  ensureUploadReport,
  failUploadReport,
  finishSubmit,
  patchSubmission,
  restoreUpload,
  resumeGroupSearch,
  resumeSubmit,
  setGroupSearch,
  setSpectralBbcode,
  updateUploadReport
} from '../upload'
import { SPECTRAL_PLACEHOLDER, SOURCE_TORRENT_PLACEHOLDER } from '@main/core/tools/upload/descriptions'
import type { UploadFormatPayload, UploadSubmission } from '@shared/types'
import { emptyGroupSearch } from '../groupSearch'
import { newState } from '../state'
import { fingerprintUploadInputs } from '../uploadReport'
import { JPEG, TEST_VERSION, cfgWithCoverHost, cfgWithTrackers } from './uploadTestFixtures'

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
  it('restores saved tracker cover URLs', () => {
    const restored = restoreUpload({
      ...emptyUpload(),
      hostedCoverImages: {
        redacted: { host: 'redacted', url: 'https://red-image.example/cover.jpg' },
        orpheus: { host: 'thesungod', url: 'https://ra-image.example/cover.jpg' }
      }
    })

    expect(restored.hostedCoverImages).toEqual({
      redacted: { host: 'redacted', url: 'https://red-image.example/cover.jpg' },
      orpheus: { host: 'thesungod', url: 'https://ra-image.example/cover.jpg' }
    })
  })

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
  const format = (id: string, releaseDesc: string): UploadFormatPayload => ({
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
        format('source', `${SPECTRAL_PLACEHOLDER}[b]16 bit [color=#2E86C1]44.1[/color] kHz[/b]\n`),
        format('mp3', `[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}\n`)
      ]
    })
    state = setSpectralBbcode(state, '[hide=Spectrals]x[/hide]\n')

    expect(state.upload.spectralBbcode).toBe('[hide=Spectrals]x[/hide]\n')
    expect(state.upload.formats![0]!.releaseDesc).toBe(
      '[hide=Spectrals]x[/hide]\n[b]16 bit [color=#2E86C1]44.1[/color] kHz[/b]\n'
    )
    expect(state.upload.formats![1]!.releaseDesc).toBe(
      `[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}\n`
    )
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

  it('clears hosted cover URLs when the local cover path changes', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-cover-change-'))
    await writeFile(path.join(dir, 'cover.jpg'), JPEG)
    const state = newState()
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
      coverPath: '/old/cover.jpg',
      hostedCoverImages: {
        redacted: { host: 'imgbb', url: 'https://i.ibb.co/old.jpg' }
      },
      seededFrom: 'stale'
    }

    const next = await ensureUploadReport(state, cfgWithCoverHost(), TEST_VERSION)

    expect(next.upload.coverPath).toBe(path.join(dir, 'cover.jpg'))
    expect(next.upload.hostedCoverImages).toEqual({})
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

  it('keeps an empty tracker selection when the report rebuilds', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-no-trackers-'))
    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020',
      genres: ['electronic']
    }
    const cfg = cfgWithTrackers(['redacted', 'orpheus'])
    state = await ensureUploadReport(state, cfg, TEST_VERSION)
    state = updateUploadReport(state, { selectedTrackerIds: [] })

    // Returning from an earlier step can rebuild the report after upstream
    // state changes. An empty list is still a user choice, not a request to
    // restore every enabled tracker.
    state.tags.proposed = { ...state.tags.proposed, title: 'Album II' }
    const next = await ensureUploadReport(state, cfg, TEST_VERSION)

    expect(next.upload.selectedTrackerIds).toEqual([])
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

  it('backfills empty tags on cached upload reports from file genres', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-tags-'))
    let state = newState()
    state.draft.workspacePath = dir
    state.draft.sourceMedia = 'WEB'
    state.tags.current = { genres: ['Electronic', 'Ambient'], mixed: { genres: true } }
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'A', role: 'main' }],
      groupYear: '2020'
    }
    state.upload = {
      ...emptyUpload(),
      phase: 'ready',
      tags: '',
      seededFrom: fingerprintUploadInputs(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    }

    state = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    expect(state.upload.tags).toBe('electronic, ambient')
  })

  it('keeps typed tags when the report rebuilds', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-upload-tags-keep-'))
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
    state = updateUploadReport(state, { tags: 'hip.hop, boom.bap' })
    state.tags.proposed = { ...state.tags.proposed, title: 'Album II' }

    const next = await ensureUploadReport(state, cfgWithTrackers(['redacted']), TEST_VERSION)
    expect(next.upload.title).toBe('Album II')
    expect(next.upload.tags).toBe('hip.hop, boom.bap')
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
})
