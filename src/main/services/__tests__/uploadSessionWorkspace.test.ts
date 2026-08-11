import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '@shared/types/config'
import { defaultConfig } from '@main/core/config/defaults'
import { newState, type State } from '@main/core/uploadflow'
import { uploadWorkspaceRootForPath, workspaceRoot } from '@main/core/appdata/workspace'
import { UploadSession } from '@main/services/uploadSession'
import { automaticToolResolver } from '@main/core/tools/binaries'

let userDataPath = ''
let sourceRoot = ''

function newSession(config = defaultConfig()): UploadSession {
  return new UploadSession({
    userDataPath,
    getConfig: () => config,
    tools: automaticToolResolver,
    send: () => {}
  })
}

function setState(session: UploadSession, state: State): void {
  const runtime = (session as unknown as { runtime: { apply: (next: State) => void } }).runtime
  runtime.apply(state)
}

async function makeSource(name: string): Promise<string> {
  const path = join(sourceRoot, name)
  await mkdir(path, { recursive: true })
  await writeFile(join(path, '01.flac'), 'not really a flac')
  return path
}

async function workspaceDirs(): Promise<string[]> {
  const entries = await readdir(workspaceRoot(userDataPath), { withFileTypes: true })
  return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()
}

beforeEach(async () => {
  userDataPath = await mkdtemp(join(tmpdir(), 'gravlax-userdata-'))
  sourceRoot = await mkdtemp(join(tmpdir(), 'gravlax-source-'))
})

afterEach(async () => {
  await rm(userDataPath, { recursive: true, force: true })
  await rm(sourceRoot, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('source selection', () => {
  it('moves to files check and reads the media off the folder', async () => {
    const session = newSession()
    await session.startNew(await makeSource('album'))

    const state = session.getState()
    expect(state.currentStep).toBe(0)
    expect(state.draft.sourceMedia).toBe('WEB')
    expect(state.background.tasks.map((t) => t.id).sort()).toEqual([
      'files-check',
      'metadata',
      'spectrals',
      'transcode'
    ])
  })

  it('reads a folder carrying a rip log as CD', async () => {
    const album = await makeSource('cd-album')
    await writeFile(join(album, 'rip.log'), 'Exact Audio Copy')

    const session = newSession()
    await session.startNew(album)

    expect(session.getState().draft.sourceMedia).toBe('CD')
  })
})

describe('workspace lifecycle', () => {
  it('keeps each workspace when switching uploads and resumes the selected one', async () => {
    const album = await makeSource('album')
    const other = await makeSource('other')

    // Session A stages `album` and leaves a resumable workspace behind.
    const firstSession = newSession()
    await firstSession.startNew(album)
    await firstSession.flushPersist()
    const firstEntries = await firstSession.listStartEntries()
    const albumEntry = firstEntries.resumeEntries.find((entry) => entry.sourcePath === album)!
    const albumWorkspaces = await workspaceDirs()
    expect(albumWorkspaces).toHaveLength(1)

    const session = newSession()
    await session.startNew(other)
    expect(await workspaceDirs()).toHaveLength(2)

    await session.resume(albumEntry.workspacePath)
    expect(session.getState().draft.sourcePath).toBe(album)
    expect(await workspaceDirs()).toHaveLength(2)
    expect(await workspaceDirs()).toEqual(expect.arrayContaining(albumWorkspaces))
  })

  it('starting again creates another workspace without removing saved work', async () => {
    const album = await makeSource('album')
    const other = await makeSource('other')

    await newSession().startNew(album)
    const albumWorkspaces = await workspaceDirs()

    const session = newSession()
    await session.startNew(other)
    await session.startNew(album)

    const after = await workspaceDirs()
    expect(after).toHaveLength(3)
    expect(after).toEqual(expect.arrayContaining(albumWorkspaces))
  })

  it('keeps the current workspace when copying a new source fails', async () => {
    const album = await makeSource('album')
    const session = newSession()

    await session.startNew(album)
    const before = await workspaceDirs()
    expect(before).toHaveLength(1)

    await session.startNew(join(sourceRoot, 'does-not-exist'))

    // The copy failed, so the staged copy the user already had is still here.
    expect(await workspaceDirs()).toEqual(before)
    const entries = await session.listStartEntries()
    expect(entries.resumeEntries.some((entry) => entry.sourcePath === album)).toBe(true)
  })
})

describe('finishing an upload', () => {
  async function settledSession(config: Config, phase: 'done' | 'failed'): Promise<{
    session: UploadSession
    workspacePath: string
  }> {
    const session = newSession(config)
    await session.startNew(await makeSource('finished-album'))
    const state = session.getState() as State
    state.currentStep = 6
    state.upload = {
      phase: 'done',
      artists: [
        { name: 'Main Artist', importance: 1 },
        { name: 'Guest Artist', importance: 2 }
      ]
    }
    state.seed = {
      phase,
      tasks: [
        {
          id: 'copy:flac',
          kind: 'copy',
          label: 'FLAC',
          status: phase === 'done' ? 'done' : 'failed'
        }
      ]
    }
    setState(session, state)
    await session.flushPersist()
    return { session, workspacePath: state.draft.workspacePath }
  }

  it('records the upload, removes an eligible workspace, and resets', async () => {
    const { session, workspacePath } = await settledSession(defaultConfig(), 'done')

    await expect(session.finish()).resolves.toEqual({ ok: true })

    expect(session.getState()).toEqual(newState())
    await expect(readdir(uploadWorkspaceRootForPath(workspacePath))).rejects.toMatchObject({
      code: 'ENOENT'
    })
    const entries = await session.listStartEntries()
    expect(entries.uploadedEntries).toHaveLength(1)
    expect(entries.uploadedEntries[0]?.artists).toEqual(['Main Artist'])
  })

  it('keeps a resumable workspace when cleanup is disabled', async () => {
    const config = defaultConfig()
    config.cleanup.deleteTemporaryFiles = false
    const { session, workspacePath } = await settledSession(config, 'done')

    await expect(session.finish()).resolves.toEqual({ ok: true })

    expect(session.getState()).toEqual(newState())
    const saved = JSON.parse(
      await readFile(join(uploadWorkspaceRootForPath(workspacePath), 'upload-flow.json'), 'utf8')
    )
    expect(saved.currentStepID).toBe('seed')
    const entries = await session.listStartEntries()
    expect(entries.resumeEntries).toHaveLength(0)
    expect(entries.uploadedEntries).toHaveLength(1)
  })

  it('keeps the workspace after failed seeding', async () => {
    const { session, workspacePath } = await settledSession(defaultConfig(), 'failed')

    await expect(session.finish()).resolves.toEqual({
      ok: false,
      error: 'Finish seeding before completing this upload.'
    })

    expect(session.getState().seed.phase).toBe('failed')
    await expect(readFile(join(uploadWorkspaceRootForPath(workspacePath), 'upload-flow.json'))).resolves.toBeTruthy()
  })

  it('does not finish while seeding is still running', async () => {
    const session = newSession()
    await session.startNew(await makeSource('running-album'))
    const state = session.getState() as State
    state.currentStep = 6
    state.upload = { phase: 'done' }
    state.seed = { phase: 'running', tasks: [] }
    setState(session, state)

    await expect(session.finish()).resolves.toEqual({
      ok: false,
      error: 'Finish seeding before completing this upload.'
    })

    expect(session.getState().currentStep).toBe(6)
    expect(session.getState().seed.phase).toBe('running')
  })

  it('keeps the session open when history cannot be written', async () => {
    const { session, workspacePath } = await settledSession(defaultConfig(), 'done')
    await mkdir(join(userDataPath, 'upload-history.json'))

    const result = await session.finish()

    expect(result.ok).toBe(false)
    expect(session.getState().draft.workspacePath).toBe(workspacePath)
    await expect(readFile(join(uploadWorkspaceRootForPath(workspacePath), 'upload-flow.json'))).resolves.toBeTruthy()
  })

  it('keeps Uploaded history when the workspace cache is cleared', async () => {
    const config = defaultConfig()
    config.cleanup.deleteTemporaryFiles = false
    const { session } = await settledSession(config, 'done')
    await session.finish()

    await session.clearCache()

    const entries = await session.listStartEntries()
    expect(entries.resumeEntries).toHaveLength(0)
    expect(entries.uploadedEntries).toHaveLength(1)
  })
})
