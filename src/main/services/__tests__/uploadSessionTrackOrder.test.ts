import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Release } from '@shared/types'
import { defaultConfig } from '@main/core/config/defaults'
import { initializeFiles, newState, type State } from '@main/core/uploadflow'
import { automaticToolResolver } from '@main/core/tools/binaries'
import { UploadSession } from '../uploadSession'

const mocks = vi.hoisted(() => ({
  extract: vi.fn(), fetch: vi.fn(), discover: vi.fn(), payload: vi.fn(), persist: vi.fn()
}))
vi.mock('@main/core/tags/extract', async (importOriginal) => ({
  ...await importOriginal<typeof import('@main/core/tags/extract')>(),
  extractAlbumReleaseWithEmbeddedCoverArt: mocks.extract
}))
vi.mock('@main/core/tools/metadata/release', () => ({ fetchNormalizedRelease: mocks.fetch }))
vi.mock('@main/core/tools/flacFiles', () => ({ discoverFLACFiles: mocks.discover }))
vi.mock('@main/core/tools/releaseFiles', async (importOriginal) => ({
  ...await importOriginal<typeof import('@main/core/tools/releaseFiles')>(),
  enumerateReleasePaths: mocks.payload
}))
vi.mock('@main/core/appdata/workspace', async (importOriginal) => ({
  ...await importOriginal<typeof import('@main/core/appdata/workspace')>(),
  writeUploadFlow: mocks.persist
}))

const local: Release = { tracks: [
  { discNumber: '1', trackNumber: '1', title: 'First', artists: [{ name: 'Zoe', role: 'main' }] },
  { discNumber: '1', trackNumber: '2', title: 'Second', artists: [
    { name: 'Alice', role: 'main' }, { name: 'Bob', role: 'main' }, { name: 'Writer', role: 'composer' }
  ] }
] }

function setup(initial?: State) {
  const session = new UploadSession({
    appVersion: 'test', userDataPath: '', getConfig: defaultConfig,
    trashItem: async () => {}, tools: automaticToolResolver, send: () => {}
  })
  const internal = session as unknown as {
    runtime: { current: State; apply: (next: State) => void; flushPersist: () => Promise<void> }
    loadCurrentTags: (path: string) => Promise<void>
    startTagsReleaseIfNeeded: () => Promise<void>
    ensureFilesInitialized: () => Promise<void>
  }
  const state = initial ?? newState()
  state.draft.workspacePath = '/workspace/Album'
  internal.runtime.apply(state)
  sessions.push(session)
  return { session, internal, state: () => internal.runtime.current }
}

const sessions: UploadSession[] = []
afterEach(async () => {
  await Promise.all(sessions.splice(0).map(async (session) => {
    session.cancelAll()
    await (session as unknown as { runtime: { flushPersist: () => Promise<void> } }).runtime.flushPersist()
  }))
})
beforeEach(() => {
  vi.clearAllMocks()
  mocks.extract.mockResolvedValue({
    release: structuredClone(local), relativePaths: ['Zoe.flac', 'Alice.flac'], embeddedCoverArtCount: 0
  })
  mocks.fetch.mockResolvedValue({ tracks: [
    { trackNumber: '1', title: 'Fetched First' }, { trackNumber: '2', title: 'Fetched Second' }
  ] })
  mocks.discover.mockResolvedValue([{ relativePath: 'Alice.flac' }, { relativePath: 'Zoe.flac' }])
  mocks.payload.mockResolvedValue({ files: ['Alice.flac', 'Zoe.flac'], directories: [] })
})

describe('session track pairing', () => {
  it('waits for local tags when metadata is selected first, then seeds correctly paired proposals', async () => {
    const test = setup()
    test.session.selectMetadataMatch({ provider: 'bandcamp', releaseId: 'album' })
    await test.internal.startTagsReleaseIfNeeded()
    expect(mocks.fetch).not.toHaveBeenCalled()

    await test.internal.loadCurrentTags('/workspace/Album')
    await vi.waitFor(() => expect(test.state().tags.releaseStatus).toBe('ready'))

    expect(test.state().files.apply.files.map((file) => file.currentPath)).toEqual(['Zoe.flac', 'Alice.flac'])
    expect(test.state().tags.proposed?.tracks?.map((track) => track.title))
      .toEqual(['Fetched First', 'Fetched Second'])
    expect(test.state().tags.proposed?.tracks?.[1]?.artists).toEqual(local.tracks?.[1]?.artists)
    expect(mocks.fetch).toHaveBeenCalledOnce()
  })

  it.each(['manual', 'keep-existing-tags'])('seeds %s only after local tags load', async (provider) => {
    const test = setup()
    test.session.selectMetadataMatch({ provider })
    expect(test.state().tags.releaseStatus).not.toBe('ready')
    await test.internal.loadCurrentTags('/workspace/Album')
    expect(test.state().tags.proposed).toEqual(local)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('reorders an untouched draft on explicit reload while keeping IDs, overrides, and original paths', async () => {
    const initial = initializeFiles(newState(), 'Album', ['Alice.flac', 'Zoe.flac'])
    initial.files.apply.files[0]!.filenameOverride = 'Custom second'
    initial.metadata.selected = { provider: 'manual' }
    initial.tags.orderingNotice = 'Old fallback'
    const test = setup(initial)

    await test.session.refreshTags()

    expect(mocks.extract).toHaveBeenCalledWith('/workspace/Album', undefined)
    expect(test.state().files.apply.files).toEqual([
      { id: 'track-2', currentPath: 'Zoe.flac' },
      { id: 'track-1', currentPath: 'Alice.flac', filenameOverride: 'Custom second' }
    ])
    expect(test.state().files.apply.payloadPaths?.find((file) => file.id === 'track-1')?.originalPath)
      .toBe('Alice.flac')
    expect(test.state().tags.orderingNotice).toBeUndefined()
    expect(test.state().tags.proposed).toEqual(local)
  })

  it.each(['modified', 'failed', 'uploaded', 'seeding', 'grandfathered'])(
    'keeps saved order on reload when the session is %s', async (condition) => {
      const initial = initializeFiles(newState(), 'Album', ['Zoe.flac', 'Alice.flac'])
      initial.metadata.selected = { provider: 'manual' }
      initial.tags.orderingNotice = 'Saved notice'
      if (condition === 'modified') initial.files.apply.onDiskModified = true
      if (condition === 'failed') initial.files.apply.phase = 'failed'
      if (condition === 'uploaded') initial.upload.phase = 'done'
      if (condition === 'seeding') initial.seed.phase = 'done'
      if (condition === 'grandfathered') initial.files.apply.grandfathered = true
      const test = setup(initial)
      await test.session.refreshTags()
      expect(mocks.extract).toHaveBeenCalledWith('/workspace/Album', ['Zoe.flac', 'Alice.flac'])
      expect(test.state().tags.orderingNotice).toBe('Saved notice')
    }
  )

  it('preserves saved edits on an ordinary tag read and never reruns automatic ordering', async () => {
    const initial = initializeFiles(newState(), 'Album', ['Zoe.flac', 'Alice.flac'])
    initial.metadata.selected = { provider: 'manual' }
    const edited: Release = { tracks: [{ title: 'Edited First' }, { title: 'Edited Second' }] }
    initial.tags = { proposed: edited, proposedDirty: true, releaseStatus: 'ready', orderingNotice: 'Saved notice' }
    const test = setup(initial)
    await test.internal.loadCurrentTags('/workspace/Album')
    expect(mocks.extract).toHaveBeenCalledWith('/workspace/Album', ['Zoe.flac', 'Alice.flac'])
    expect(test.state().tags.proposed).toEqual(edited)
    expect(test.state().tags.proposedDirty).toBe(true)
    expect(test.state().tags.orderingNotice).toBe('Saved notice')
  })

  it('reconstructs legacy file order from filenames, but lets a fresh session use tag order', async () => {
    const legacy = newState()
    legacy.tags.current = { tracks: [{ title: 'Second' }, { title: 'First' }] }
    const old = setup(legacy)
    await old.internal.ensureFilesInitialized()
    expect(old.state().files.apply.files.map((file) => file.currentPath)).toEqual(['Alice.flac', 'Zoe.flac'])

    const fresh = setup()
    await fresh.internal.ensureFilesInitialized()
    expect(fresh.state().files.apply.files).toEqual([])
    await fresh.internal.loadCurrentTags('/workspace/Album')
    expect(fresh.state().files.apply.files.map((file) => file.currentPath)).toEqual(['Zoe.flac', 'Alice.flac'])
  })

  it('stores the filename fallback notice on automatic reads', async () => {
    mocks.extract.mockResolvedValueOnce({
      release: local, relativePaths: ['Alice.flac', 'Zoe.flac'],
      embeddedCoverArtCount: 0, orderingNotice: 'Using filename order'
    })
    const test = setup()
    await test.internal.loadCurrentTags('/workspace/Album')
    expect(test.state().tags.orderingNotice).toBe('Using filename order')
  })
})
