import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '@shared/types/config'
import type { OriginalFileSnapshot } from '@shared/types'

const mocks = vi.hoisted(() => ({
  applyTagsAndRenames: vi.fn(),
  captureOriginalFiles: vi.fn(),
  restoreOriginalFiles: vi.fn(),
  extractAlbumRelease: vi.fn(),
  buildFilesRenamePlan: vi.fn()
}))

vi.mock('@main/core/tools/files/apply', () => ({
  applyTagsAndRenames: mocks.applyTagsAndRenames,
  captureOriginalFiles: mocks.captureOriginalFiles,
  restoreOriginalFiles: mocks.restoreOriginalFiles
}))

vi.mock('@main/core/tags/extract', () => ({
  extractAlbumRelease: mocks.extractAlbumRelease
}))

vi.mock('@shared/upload/naming', () => ({
  buildFilesRenamePlan: mocks.buildFilesRenamePlan
}))

import { newState, type State } from '@main/core/uploadflow'
import { TaskScope } from '@main/services/taskSlot'
import { UploadSessionFileChanges } from '@main/services/uploadSessionFileChanges'
import { automaticToolResolver } from '@main/core/tools/binaries'

const originalFile: OriginalFileSnapshot = {
  id: 'track-1',
  relativePath: 'old.flac',
  managedComments: []
}

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
        captured: true,
        coverCaptured: true,
        folderName: 'Old Album',
        files: [originalFile]
      },
      apply: {
        phase: 'idle',
        onDiskModified: false,
        stripEmbeddedCoverArt: true,
        renameReleaseFolder: true,
        currentFolderName: 'Old Album',
        files: [{ id: 'track-1', currentPath: 'old.flac' }]
      }
    }
  }
  const startTranscodeInspection = vi.fn()
  const notify = vi.fn()
  const scope = new TaskScope()
  const service = new UploadSessionFileChanges(
    {
      getState: () => state,
      apply: (next) => {
        state = next
      },
      persistNow: async () => {},
      getConfig: () => ({ workflow: { confirmBeforeWrites: false } }) as Config,
      tools: automaticToolResolver,
      createWorkspaceGuard: (workspacePath) => () => state.draft.workspacePath === workspacePath,
      cancelGeneratedWork: vi.fn(),
      startTranscodeInspection,
      notify
    },
    scope.slot('file-changes')
  )
  return { service, getState: () => state, startTranscodeInspection, notify }
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
    mocks.captureOriginalFiles.mockResolvedValue({ originals: [originalFile], pictureCount: 0 })
    mocks.applyTagsAndRenames.mockResolvedValue({
      workspacePath: '/workspace/New Album',
      folderName: 'New Album',
      currentPaths: [{ id: 'track-1', currentPath: '01. Track.flac' }],
      changedFileCount: 1,
      strippedPictureCount: 0
    })
  })

  it('keeps a successful apply current after it renames the release folder', async () => {
    const { service, getState, startTranscodeInspection } = setup()

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })
    expect(getState().draft.workspacePath).toBe('/workspace/New Album')
    expect(startTranscodeInspection).toHaveBeenCalledOnce()
  })

  it('starts a pending inspection when the applied files already match', async () => {
    const { service, startTranscodeInspection } = setup()
    await service.applyTagsAndNames(true)
    startTranscodeInspection.mockClear()

    await expect(service.applyTagsAndNames(true)).resolves.toEqual({ ok: true })
    expect(startTranscodeInspection).toHaveBeenCalledOnce()
    expect(mocks.applyTagsAndRenames).toHaveBeenCalledOnce()
  })

  it('keeps a successful restore current after it restores the folder name', async () => {
    const test = setup()
    await test.service.applyTagsAndNames(true)
    mocks.restoreOriginalFiles.mockResolvedValue('/workspace/Old Album')
    mocks.extractAlbumRelease.mockResolvedValue({ title: 'Old Album' })

    await expect(test.service.revertFiles()).resolves.toEqual({ ok: true })
    expect(test.getState().draft.workspacePath).toBe('/workspace/Old Album')
    expect(test.startTranscodeInspection).toHaveBeenCalledTimes(2)
  })
})
