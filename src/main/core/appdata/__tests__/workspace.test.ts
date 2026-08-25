import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyFolderToUploadWorkspace } from '../workspace'

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
})
