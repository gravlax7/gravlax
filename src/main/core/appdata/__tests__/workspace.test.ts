import { access, mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearWorkspace,
  copyFolderToUploadWorkspace,
  prepareWorkspaceRoot,
  replaceWorkingCopyFromSource,
  sourceRestoreStatus,
  uploadWorkspaceRootForPath,
  validateWorkspaceTarget,
  workspaceAvailable,
  workspaceRoot,
  workspaceSize
} from '../workspace'

let root = ''
let userDataPath = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-workspace-copy-'))
  userDataPath = join(root, 'user-data')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('upload workspace copy', () => {
  it('omits empty folder trees without changing the source', async () => {
    const source = join(root, 'Album')
    await mkdir(join(source, 'empty', 'nested'), { recursive: true })
    await mkdir(join(source, 'art', 'empty'), { recursive: true })
    await writeFile(join(source, '01.flac'), 'audio')
    await writeFile(join(source, 'art', 'cover.jpg'), 'image')

    const workspace = await copyFolderToUploadWorkspace(userDataPath, source)

    expect((await readdir(workspace)).sort()).toEqual(['01.flac', 'art'])
    expect(await readdir(join(workspace, 'art'))).toEqual(['cover.jpg'])
    await expect(access(join(source, 'empty', 'nested'))).resolves.toBeUndefined()
    await expect(access(join(source, 'art', 'empty'))).resolves.toBeUndefined()
  })

  it('still creates the release root when the source is empty', async () => {
    const source = join(root, 'Empty Album')
    await mkdir(source, { recursive: true })

    const workspace = await copyFolderToUploadWorkspace(userDataPath, source)

    expect(await readdir(workspace)).toEqual([])
  })

  it('records a source fingerprint that still matches after copy', async () => {
    const source = join(root, 'Album')
    await mkdir(source)
    await writeFile(join(source, '01.flac'), 'audio')

    const workspace = await copyFolderToUploadWorkspace(userDataPath, source)
    expect(await sourceRestoreStatus(uploadWorkspaceRootForPath(workspace))).toEqual({ available: true })
  })

  it('treats a missing source folder as moved', async () => {
    const source = join(root, 'Album')
    await mkdir(source)
    await writeFile(join(source, '01.flac'), 'audio')
    const workspace = await copyFolderToUploadWorkspace(userDataPath, source)
    await rm(source, { recursive: true, force: true })

    expect(await sourceRestoreStatus(uploadWorkspaceRootForPath(workspace))).toEqual({
      available: false,
      reason: 'moved'
    })
  })

  it('treats a changed source file as changed', async () => {
    const source = join(root, 'Album')
    await mkdir(source)
    const file = join(source, '01.flac')
    await writeFile(file, 'audio')
    const workspace = await copyFolderToUploadWorkspace(userDataPath, source)
    await writeFile(file, 'audio changed')
    await utimes(file, 1, 1)

    expect(await sourceRestoreStatus(uploadWorkspaceRootForPath(workspace))).toEqual({
      available: false,
      reason: 'changed'
    })
  })

  it('replaces the working copy from the source folder', async () => {
    const source = join(root, 'Album')
    await mkdir(join(source, 'CD1'), { recursive: true })
    await writeFile(join(source, 'CD1', 'a.flac'), 'original')
    await writeFile(join(source, 'notes.txt'), 'keep')
    const workspace = await copyFolderToUploadWorkspace(userDataPath, source)
    await writeFile(join(workspace, 'CD1', 'a.flac'), 'tagged')
    await rm(join(workspace, 'notes.txt'))

    const restored = await replaceWorkingCopyFromSource(workspace, source)
    expect(await readFile(join(restored, 'CD1', 'a.flac'), 'utf8')).toBe('original')
    expect(await readFile(join(restored, 'notes.txt'), 'utf8')).toBe('keep')
    expect(await sourceRestoreStatus(uploadWorkspaceRootForPath(restored))).toEqual({ available: true })
  })
})

describe('custom workspace root', () => {
  it('uses the exact marked folder and keeps its marker when cleared', async () => {
    const custom = join(root, 'custom-workspace')
    await mkdir(custom)
    await expect(validateWorkspaceTarget(userDataPath, custom)).resolves.toBeNull()
    await prepareWorkspaceRoot(userDataPath, custom)

    const source = join(root, 'Custom Album')
    await mkdir(source)
    await writeFile(join(source, '01.flac'), 'audio')
    const workspace = await copyFolderToUploadWorkspace(userDataPath, source, custom)

    expect(uploadWorkspaceRootForPath(workspace).startsWith(custom)).toBe(true)
    expect(workspaceRoot(userDataPath, custom)).toBe(custom)
    expect(await workspaceSize(userDataPath, custom)).toBeGreaterThan(0)

    await clearWorkspace(userDataPath, custom)
    expect(await readdir(custom)).toEqual(['.gravlax-workspace'])
    await expect(workspaceAvailable(userDataPath, custom)).resolves.toEqual({ available: true })
  })

  it('rejects a non-empty folder that Gravlax does not own', async () => {
    const custom = join(root, 'music')
    await mkdir(custom)
    await writeFile(join(custom, 'keep.txt'), 'mine')

    await expect(validateWorkspaceTarget(userDataPath, custom)).resolves.toBe(
      'Choose a new or empty folder used only by Gravlax.'
    )
    await expect(clearWorkspace(userDataPath, custom)).rejects.toThrow(
      'Choose a new or empty folder used only by Gravlax.'
    )
    await expect(readFile(join(custom, 'keep.txt'), 'utf8')).resolves.toBe('mine')
  })

  it('reports a saved custom folder as unavailable when it is missing', async () => {
    const custom = join(root, 'missing-workspace')
    await expect(workspaceAvailable(userDataPath, custom)).resolves.toEqual({
      available: false,
      error: 'Workspace folder is not available.'
    })
  })
})
