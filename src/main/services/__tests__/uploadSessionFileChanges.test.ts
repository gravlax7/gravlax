import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '@shared/types/config'
import { ARTIST_ROLE_PRESETS } from '@shared/types/upload'
import type { FilesProgressCallback } from '@main/core/tools/files/apply'

const mocks = vi.hoisted(() => ({
  applyTagsAndRenames: vi.fn(),
  extractAlbumReleaseWithEmbeddedCoverArt: vi.fn(),
  buildFilesRenamePlan: vi.fn(),
  replaceWorkingCopyFromSource: vi.fn(),
  discoverFLACFiles: vi.fn(),
  enumerateReleasePaths: vi.fn()
}))

vi.mock('@main/core/tools/files/apply', () => ({
  applyTagsAndRenames: mocks.applyTagsAndRenames
}))

vi.mock('@main/core/tags/extract', () => ({
  extractAlbumReleaseWithEmbeddedCoverArt: mocks.extractAlbumReleaseWithEmbeddedCoverArt
}))

vi.mock('@shared/upload/naming', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shared/upload/naming')>()
  return { ...actual, buildFilesRenamePlan: mocks.buildFilesRenamePlan }
})

vi.mock('@main/core/appdata/workspace', () => ({
  replaceWorkingCopyFromSource: mocks.replaceWorkingCopyFromSource
}))

vi.mock('@main/core/tools/flacFiles', () => ({
  discoverFLACFiles: mocks.discoverFLACFiles
}))

vi.mock('@main/core/tools/releaseFiles', () => ({
  enumerateReleasePaths: mocks.enumerateReleasePaths
}))

import { newState, type State } from '@main/core/uploadflow'
import { TaskScope } from '@main/services/taskSlot'
import { UploadSessionFileChanges } from '@main/services/uploadSessionFileChanges'
import { automaticToolResolver } from '@main/core/tools/binaries'
import type { FilesRenamePlan } from '@shared/upload/naming'

function setup() {
  let state: State = {
    ...newState(),
    draft: {
      ...newState().draft,
      sourcePath: '/source/Old Album',
      workspacePath: '/workspace/Old Album',
      sourceMedia: 'WEB'
    },
    tags: {
      current: { title: 'Old Album' },
      proposed: { title: 'New Album', tracks: [{ title: 'Track' }] }
    },
    files: {
      original: {
        restoreAvailable: true
      },
      apply: {
        phase: 'idle',
        onDiskModified: false,
        stripEmbeddedCoverArt: true,
        renameReleaseFolder: true,
        renameTrackFiles: true,
        currentFolderName: 'Old Album',
        files: [{ id: 'track-1', currentPath: 'old.flac' }]
      }
    }
  }
  const startTranscodeInspection = vi.fn()
  const runFileChecksAndWait = vi.fn(async () => {})
  const fileChecksNeedAttention = vi.fn(() => false)
  const goToFileChecks = vi.fn()
  const refreshSourceRestoreStatus = vi.fn(async () => {})
  const notify = vi.fn()
  const cancelGeneratedWork = vi.fn()
  const scope = new TaskScope()
  const service = new UploadSessionFileChanges(
    {
      getState: () => state,
      apply: (next) => {
        state = next
      },
      persistNow: async () => {},
      getConfig: () => ({
        workflow: { confirmBeforeWrites: false },
        naming: {
          albumDescriptionTemplateId: 'x',
          releaseFolderTemplate: '{artists} - {title} ({year}) [{source} {format}]',
          trackFileTemplate: '{trackNumber}. {title}',
          useVariousArtistsTrackFileTemplate: true,
          variousArtistsTrackFileTemplate: '{trackNumber}. {artist} - {title}',
          multiDiscFolderTemplate: 'Disc {discNumber}'
        }
      }) as Config,
      tools: automaticToolResolver,
      createWorkspaceGuard: (workspacePath) => () => state.draft.workspacePath === workspacePath,
      cancelGeneratedWork,
      startTranscodeInspection,
      runFileChecksAndWait,
      fileChecksNeedAttention,
      goToFileChecks,
      refreshSourceRestoreStatus,
      notify
    },
    scope.slot('file-changes')
  )
  return {
    service,
    getState: () => state,
    startTranscodeInspection,
    runFileChecksAndWait,
    fileChecksNeedAttention,
    goToFileChecks,
    notify,
    cancelGeneratedWork
  }
}

describe('UploadSessionFileChanges folder renames', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.buildFilesRenamePlan.mockReturnValue({
      folderName: 'New Album',
      files: [
        {
          id: 'track-1',
          currentPath: 'old.flac',
          targetPath: '01. Track.flac',
          targetFilename: '01. Track.flac',
          changed: true
        }
      ],
      errors: [],
      warnings: [],
      hash: 'plan'
    })
    mocks.applyTagsAndRenames.mockResolvedValue({
      workspacePath: '/workspace/New Album',
      folderName: 'New Album',
      currentPaths: [{ id: 'track-1', currentPath: '01. Track.flac' }],
      changedFileCount: 1,
      strippedPictureCount: 0
    })
    mocks.replaceWorkingCopyFromSource.mockResolvedValue('/workspace/Old Album')
    mocks.discoverFLACFiles.mockResolvedValue([{ relativePath: 'old.flac' }])
    mocks.enumerateReleasePaths.mockResolvedValue({ files: ['old.flac'], directories: [] })
    mocks.extractAlbumReleaseWithEmbeddedCoverArt.mockResolvedValue({
      release: { title: 'Old Album' },
      embeddedCoverArtCount: 0
    })
  })

  it('keeps a successful apply current after it renames the release folder', async () => {
    const { service, getState, startTranscodeInspection } = setup()

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })
    expect(getState().draft.workspacePath).toBe('/workspace/New Album')
    expect(startTranscodeInspection).toHaveBeenCalledOnce()
  })

  it('shows the applying phase while tags are written', async () => {
    const { service, getState } = setup()
    let finishApply: ((value: unknown) => void) | undefined
    mocks.applyTagsAndRenames.mockReturnValueOnce(new Promise((resolve) => {
      finishApply = resolve
    }))

    const applying = service.applyTagsAndNames(true)

    expect(getState().files.apply.phase).toBe('applying')
    expect(getState().files.apply.progressCurrent).toBe(0)
    expect(getState().files.apply.progressTotal).toBe(2)
    expect(getState().files.apply.progressLabel).toBe('Applying tags and filenames…')
    finishApply?.({
      workspacePath: '/workspace/New Album',
      folderName: 'New Album',
      currentPaths: [{ id: 'track-1', currentPath: '01. Track.flac' }],
      changedFileCount: 1,
      strippedPictureCount: 0
    })
    await expect(applying).resolves.toEqual({ ok: true })
  })

  it('reports write progress as the file-change total', async () => {
    const { service, getState } = setup()
    const progress: Array<{ current?: number; total?: number; label?: string }> = []
    mocks.applyTagsAndRenames.mockImplementationOnce(async (input: {
      onProgress?: FilesProgressCallback
    }) => {
      input.onProgress?.(1, 2, 'Applied tags: old.flac')
      progress.push({
        current: getState().files.apply.progressCurrent,
        total: getState().files.apply.progressTotal,
        label: getState().files.apply.progressLabel
      })
      input.onProgress?.(2, 2, 'Finishing…')
      progress.push({
        current: getState().files.apply.progressCurrent,
        total: getState().files.apply.progressTotal,
        label: getState().files.apply.progressLabel
      })
      return {
        workspacePath: '/workspace/New Album',
        folderName: 'New Album',
        currentPaths: [{ id: 'track-1', currentPath: '01. Track.flac' }],
        changedFileCount: 1,
        strippedPictureCount: 0
      }
    })

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })

    expect(progress).toEqual([
      { current: 1, total: 2, label: 'Applied tags: old.flac' },
      { current: 2, total: 2, label: 'Finishing…' }
    ])
    expect(getState().files.apply.progressTotal).toBeUndefined()
  })

  it('starts a pending inspection when the applied files already match', async () => {
    const { service, startTranscodeInspection } = setup()
    await service.applyTagsAndNames(true)
    startTranscodeInspection.mockClear()

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })
    expect(startTranscodeInspection).toHaveBeenCalledOnce()
    expect(mocks.applyTagsAndRenames).toHaveBeenCalledOnce()
  })

  it.each([true, false])('skips unchanged tags after reading applied files back (rename: %s)', async (rename) => {
    const naming = await vi.importActual<typeof import('@shared/upload/naming')>('@shared/upload/naming')
    mocks.buildFilesRenamePlan.mockImplementation(naming.buildFilesRenamePlan)
    const { service, getState, cancelGeneratedWork, notify } = setup()
    getState().files.apply.renameReleaseFolder = rename
    getState().files.apply.renameTrackFiles = rename
    getState().metadata.selected = { provider: 'manual' }
    const artists = [
      { name: 'Lead', role: 'main' },
      { name: 'Producer', role: 'producer' }
    ]
    service.updateTagsProposed({ ...getState().tags.proposed, artists })
    mocks.applyTagsAndRenames.mockImplementation(async ({ plan }: { plan: FilesRenamePlan }) => ({
      workspacePath: `/workspace/${plan.folderName}`,
      folderName: plan.folderName,
      currentPaths: plan.files.map((file) => ({ id: file.id, currentPath: file.targetPath })),
      payloadPaths: (plan.payloadFiles ?? []).map((file) => ({ id: file.id, currentPath: file.targetPath })),
      changedFileCount: plan.files.filter((file) => file.changed).length,
      strippedPictureCount: 0
    }))
    mocks.extractAlbumReleaseWithEmbeddedCoverArt.mockResolvedValue({
      release: {
        title: 'New Album',
        trackCount: 1,
        tracks: [{ title: 'Track', trackNumber: '1', discNumber: '1' }]
      },
      embeddedCoverArtCount: 0
    })

    await expect(service.applyTagsAndNames()).resolves.toEqual({ ok: true })
    expect(getState().tags.proposed?.artists).toEqual(artists)
    const transcode = getState().transcode
    transcode.phase = 'done'
    const upload = getState().upload
    cancelGeneratedWork.mockClear()
    notify.mockClear()

    // Crossing Tags again after revisiting Metadata must preserve prepared work.
    await expect(service.applyTagsAndNames()).resolves.toEqual({ ok: true })
    expect(mocks.applyTagsAndRenames).toHaveBeenCalledOnce()
    expect(cancelGeneratedWork).not.toHaveBeenCalled()
    expect(notify).not.toHaveBeenCalled()
    expect(getState().transcode).toBe(transcode)
    expect(getState().upload).toBe(upload)

    service.updateTagsProposed({ ...getState().tags.proposed, comment: 'Edited' })
    await expect(service.applyTagsAndNames()).resolves.toEqual({ ok: true })
    expect(mocks.applyTagsAndRenames).toHaveBeenCalledTimes(2)
  })

  it('marks a keep-existing no-op complete without a worker or confirmation', async () => {
    const { service, getState, startTranscodeInspection, cancelGeneratedWork } = setup()
    getState().metadata.selected = { provider: 'keep-existing-tags' }
    getState().files.apply.renameReleaseFolder = false
    getState().files.apply.renameTrackFiles = false
    getState().files.apply.stripEmbeddedCoverArt = false
    mocks.buildFilesRenamePlan.mockReturnValueOnce({
      folderName: 'Old Album',
      files: [{
        id: 'track-1',
        currentPath: 'old.flac',
        targetPath: 'old.flac',
        targetFilename: 'old.flac',
        changed: false
      }],
      payloadFiles: [{
        id: 'track-1',
        kind: 'file',
        currentPath: 'old.flac',
        targetPath: 'old.flac',
        targetName: 'old.flac',
        changed: false,
        track: true
      }],
      folders: [],
      errors: [],
      warnings: [],
      hash: 'keep-noop'
    })

    await expect(service.applyTagsAndNames()).resolves.toEqual({ ok: true })

    expect(mocks.applyTagsAndRenames).not.toHaveBeenCalled()
    expect(cancelGeneratedWork).not.toHaveBeenCalled()
    expect(startTranscodeInspection).toHaveBeenCalledOnce()
    expect(getState().files.apply).toMatchObject({
      phase: 'applied',
      appliedHash: 'keep-noop',
      onDiskModified: false
    })
  })

  it('turns both renames on when current names are over the upload path limit', async () => {
    const { service, getState } = setup()
    getState().metadata.selected = { provider: 'keep-existing-tags' }
    getState().files.apply.renameReleaseFolder = false
    getState().files.apply.renameTrackFiles = false
    getState().files.apply.stripEmbeddedCoverArt = false
    getState().files.apply.currentFolderName = 'Album'
    getState().files.apply.files = [{ id: 'track-1', currentPath: `${'x'.repeat(180)}.flac` }]
    getState().tags.proposed = { title: 'Album', tracks: [{ title: 'Song' }] }

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })

    expect(getState().files.apply.renameTrackFiles).toBe(true)
    expect(getState().files.apply.renameReleaseFolder).toBe(true)
  })

  it('passes rename-only work to the worker with tag writing off', async () => {
    const { service, getState } = setup()
    getState().metadata.selected = { provider: 'keep-existing-tags' }
    getState().files.apply.stripEmbeddedCoverArt = false
    mocks.applyTagsAndRenames.mockResolvedValueOnce({
      workspacePath: '/workspace/New Album',
      folderName: 'New Album',
      currentPaths: [{ id: 'track-1', currentPath: '01. Track.flac' }],
      payloadPaths: [],
      changedFileCount: 1,
      strippedPictureCount: 0
    })

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })

    expect(mocks.applyTagsAndRenames).toHaveBeenCalledWith(
      expect.objectContaining({ writeTags: false, stripEmbeddedCoverArt: false })
    )
  })

  it('keeps parsed upload metadata after cover-only work', async () => {
    const { service, getState } = setup()
    getState().metadata.selected = { provider: 'keep-existing-tags' }
    getState().files.apply.renameReleaseFolder = false
    getState().files.apply.renameTrackFiles = false
    getState().files.original.embeddedCoverArtCount = 1
    getState().tags.proposed = {
      title: 'Old Album',
      artists: [{ name: 'Bach, Johann Sebastian', role: 'composer', separatorKept: true }],
      tracks: [{ title: 'Track' }]
    }
    mocks.buildFilesRenamePlan.mockReturnValueOnce({
      folderName: 'Old Album',
      files: [{
        id: 'track-1',
        currentPath: 'old.flac',
        targetPath: 'old.flac',
        targetFilename: 'old.flac',
        changed: false
      }],
      payloadFiles: [],
      folders: [],
      errors: [],
      warnings: [],
      hash: 'cover-only'
    })
    mocks.applyTagsAndRenames.mockResolvedValueOnce({
      workspacePath: '/workspace/Old Album',
      folderName: 'Old Album',
      currentPaths: [{ id: 'track-1', currentPath: 'old.flac' }],
      payloadPaths: [],
      changedFileCount: 0,
      strippedPictureCount: 1
    })

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })

    expect(mocks.applyTagsAndRenames).toHaveBeenCalledWith(
      expect.objectContaining({ writeTags: false, stripEmbeddedCoverArt: true })
    )
    expect(getState().tags.proposed?.artists).toEqual([
      { name: 'Bach, Johann Sebastian', role: 'composer', separatorKept: true }
    ])
    expect(getState().tags.current?.artists).toBeUndefined()
  })

  it('allows navigation past unchanged tags after seeding', async () => {
    const { service, getState, startTranscodeInspection } = setup()
    await service.applyTagsAndNames(true)
    startTranscodeInspection.mockClear()
    getState().seed.phase = 'done'
    getState().files.apply.phase = 'failed'
    getState().files.apply.error = 'Files cannot change after upload or seeding has started.'

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })
    expect(getState().files.apply.phase).toBe('applied')
    expect(getState().files.apply.error).toBeUndefined()
    expect(startTranscodeInspection).toHaveBeenCalledOnce()
    expect(mocks.applyTagsAndRenames).toHaveBeenCalledOnce()
  })

  it('still blocks file changes after seeding', async () => {
    const { service, getState } = setup()
    await service.applyTagsAndNames(true)
    getState().seed.phase = 'done'
    mocks.buildFilesRenamePlan.mockReturnValueOnce({
      folderName: 'Changed Album',
      files: [],
      errors: [],
      warnings: [],
      hash: 'changed-plan'
    })

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({
      ok: false,
      error: 'Files cannot change after upload or seeding has started.'
    })
    expect(mocks.applyTagsAndRenames).toHaveBeenCalledOnce()
  })

  it('does not apply the empty proposal while metadata is loading', async () => {
    const { service, getState } = setup()
    getState().tags = { proposed: {}, releaseStatus: 'loading' }

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({
      ok: false,
      error: 'Metadata is still loading.'
    })
    expect(mocks.applyTagsAndRenames).not.toHaveBeenCalled()
  })

  it('does not apply tags while an artist name still needs a separator choice', async () => {
    const { service, getState } = setup()
    getState().tags.proposed = {
      title: 'New Album',
      artists: [{ name: 'Bach, Jean Sebastian', role: 'composer' }],
      tracks: [{ title: 'Track' }]
    }

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({
      ok: false,
      error: 'Choose how to read artist names that contain separators.'
    })
    expect(mocks.applyTagsAndRenames).not.toHaveBeenCalled()
  })

  it('does not apply tags when a date is not YYYY, YYYY-MM, or YYYY-MM-DD', async () => {
    const { service, getState } = setup()
    getState().tags.proposed = {
      title: 'New Album',
      year: 'May 2020',
      tracks: [{ title: 'Track' }]
    }

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({
      ok: false,
      error: 'Dates must be YYYY, YYYY-MM, or YYYY-MM-DD.'
    })
    expect(mocks.applyTagsAndRenames).not.toHaveBeenCalled()
  })

  it('keeps source URLs and cover art URL after Apply rereads the files', async () => {
    const { service, getState } = setup()
    getState().tags.proposed = {
      title: 'New Album',
      cover: 'https://example.invalid/cover.jpg',
      urls: ['https://example.invalid/release'],
      tracks: [{ title: 'Track' }]
    }

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })
    expect(getState().tags.current?.cover).toBe('https://example.invalid/cover.jpg')
    expect(getState().tags.current?.urls).toEqual(['https://example.invalid/release'])
    expect(getState().tags.proposed?.cover).toBe('https://example.invalid/cover.jpg')
    expect(getState().tags.proposed?.urls).toEqual(['https://example.invalid/release'])
  })

  it.each(ARTIST_ROLE_PRESETS)('keeps an added release-level %s after reading files back', async (role) => {
    const { service, getState } = setup()
    const lead = { name: 'Lead', role: 'main' }
    const added = { name: 'Added', role }
    const artists = [lead, added]
    const tracks = [{ title: 'Track', artists: [lead] }]
    service.updateTagsProposed({ title: 'New Album', artists, tracks })
    const readBackTracks = [{ ...tracks[0], trackNumber: '1', discNumber: '1' }]
    mocks.extractAlbumReleaseWithEmbeddedCoverArt.mockResolvedValueOnce({
      release: {
        title: 'New Album',
        artists: role === 'main' ? artists : [lead],
        tracks: readBackTracks
      },
      embeddedCoverArtCount: 0
    })

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })

    expect(mocks.applyTagsAndRenames).toHaveBeenCalledWith(
      expect.objectContaining({ release: { title: 'New Album', artists, tracks } })
    )
    expect(getState().tags.current?.artists).toEqual(artists)
    expect(getState().tags.proposed?.artists).toEqual(artists)
    expect(getState().tags.current?.tracks).toEqual(readBackTracks)
    expect(getState().tags.proposed?.tracks).toEqual(readBackTracks)
    expect(getState().tags.proposedDirty).toBe(false)
  })

  it('keeps release credit edits when track credits differ after reading files back', async () => {
    const { service, getState } = setup()
    const lead = { name: 'Lead', role: 'main' }
    const trackArtists = [
      lead,
      { name: 'Removed', role: 'guest' },
      { name: 'Bach, Johann Sebastian', role: 'composer' }
    ]
    const artists = [
      lead,
      { name: 'Bach, Johann Sebastian', role: 'arranger', separatorKept: true }
    ]
    const tracks = [{
      title: 'Track',
      artists: trackArtists.map((artist) => ({ ...artist, separatorKept: true }))
    }]
    service.updateTagsProposed({ title: 'New Album', artists, tracks })
    const readBackTracks = [{ title: 'Track', artists: trackArtists }]
    mocks.extractAlbumReleaseWithEmbeddedCoverArt.mockResolvedValueOnce({
      release: { title: 'New Album', artists: trackArtists, tracks: readBackTracks },
      embeddedCoverArtCount: 0
    })

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })

    expect(getState().tags.current?.artists).toEqual(artists)
    expect(getState().tags.proposed?.artists).toEqual(artists)
    expect(getState().tags.proposed?.tracks).toEqual(readBackTracks)
  })

  it('keeps a successful restore current after it restores the folder name', async () => {
    const test = setup()
    await test.service.applyTagsAndNames(true)
    test.getState().tags.proposed = { title: 'New Album', tracks: [{ title: 'Track' }] }

    await expect(test.service.revertFiles()).resolves.toEqual({ ok: true })
    expect(test.getState().draft.workspacePath).toBe('/workspace/Old Album')
    expect(test.getState().tags.proposed?.title).toBe('New Album')
    expect(test.getState().tags.current?.title).toBe('Old Album')
    expect(test.startTranscodeInspection).toHaveBeenCalledTimes(2)
    expect(test.goToFileChecks).not.toHaveBeenCalled()
  })

  it('jumps to file checks when restore brings back problems', async () => {
    const test = setup()
    await test.service.applyTagsAndNames(true)
    test.fileChecksNeedAttention.mockReturnValue(true)

    await expect(test.service.revertFiles()).resolves.toEqual({ ok: true })
    expect(test.goToFileChecks).toHaveBeenCalledOnce()
    expect(test.notify).toHaveBeenCalledWith(
      'warning',
      'The working copy was restored from the source folder. File checks need attention.'
    )
  })
})
