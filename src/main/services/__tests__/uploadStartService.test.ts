import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { saveUploadedRelease } from '@main/core/appdata/uploadHistory'
import {
  copyFolderToUploadWorkspace,
  uploadWorkspaceRootForPath,
  writeUploadFlow
} from '@main/core/appdata/workspace'
import { listUploadStartEntries } from '@main/services/uploadStartService'

let userDataPath = ''
let sourceRoot = ''

async function source(name: string): Promise<string> {
  const path = join(sourceRoot, name)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, '01.flac'), 'audio')
  return path
}

beforeEach(async () => {
  userDataPath = await mkdtemp(join(tmpdir(), 'gravlax-start-userdata-'))
  sourceRoot = await mkdtemp(join(tmpdir(), 'gravlax-start-source-'))
})

afterEach(async () => {
  await rm(userDataPath, { recursive: true, force: true })
  await rm(sourceRoot, { recursive: true, force: true })
})

describe('upload start entries', () => {
  it('groups new, resumable, uploaded, and missing releases', async () => {
    const newPath = await source('new-album')
    const resumePath = await source('resume-album')
    const uploadedPath = await source('uploaded-album')
    const resumeWorkspace = await copyFolderToUploadWorkspace(userDataPath, resumePath)
    await writeUploadFlow(uploadWorkspaceRootForPath(resumeWorkspace), {
      sourcePath: resumePath,
      currentStepID: 'tags'
    })
    await saveUploadedRelease(userDataPath, {
      kind: 'uploaded',
      name: 'resume-album',
      sourcePath: resumePath,
      completedAt: 1,
      sourceExists: true,
      artists: [],
      submissions: []
    })
    await saveUploadedRelease(userDataPath, {
      kind: 'uploaded',
      name: 'uploaded-album',
      sourcePath: uploadedPath,
      completedAt: 2,
      sourceExists: true,
      artists: ['Artist'],
      title: 'Album',
      submissions: []
    })
    const missingPath = join(sourceRoot, 'moved-album')
    await saveUploadedRelease(userDataPath, {
      kind: 'uploaded',
      name: 'moved-album',
      sourcePath: missingPath,
      completedAt: 3,
      sourceExists: true,
      artists: [],
      submissions: []
    })

    const result = await listUploadStartEntries({ userDataPath, sourceDirectory: sourceRoot })

    expect(result.newEntries.map((entry) => entry.sourcePath)).toEqual([newPath])
    expect(result.resumeEntries).toMatchObject([
      { sourcePath: resumePath, currentStepID: 'tags', sourceExists: true }
    ])
    expect(result.uploadedEntries.map((entry) => entry.sourcePath)).toEqual([
      missingPath,
      uploadedPath
    ])
    expect(result.uploadedEntries[0]?.sourceExists).toBe(false)
  })

  it('treats a retained finished workspace as Uploaded', async () => {
    const path = await source('done-album')
    const workspace = await copyFolderToUploadWorkspace(userDataPath, path)
    await writeUploadFlow(uploadWorkspaceRootForPath(workspace), {
      sourcePath: path,
      currentStepID: 'seed',
      seed: { phase: 'done', tasks: [] }
    })
    await saveUploadedRelease(userDataPath, {
      kind: 'uploaded',
      name: 'done-album',
      sourcePath: path,
      completedAt: Date.now(),
      sourceExists: true,
      artists: [],
      submissions: []
    })

    const result = await listUploadStartEntries({ userDataPath, sourceDirectory: sourceRoot })

    expect(result.resumeEntries).toHaveLength(0)
    expect(result.uploadedEntries).toHaveLength(1)
  })
})
