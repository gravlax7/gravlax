import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import {
  newState,
  selectSourcePath,
  setCurrentStep,
  setSourceMedia,
  setSpectralIds,
  setWorkspacePath,
  stepIndex,
  type State
} from '@main/core/uploadflow'
import type {
  CompressSpectralPngsOptions,
  SpectralCompressionResult
} from '@main/core/tools/spectrals/compress'
import { automaticToolResolver } from '@main/core/tools/binaries'
import { UploadSession } from '@main/services/uploadSession'

type Optimizer = (
  filePaths: string[],
  options?: CompressSpectralPngsOptions
) => Promise<SpectralCompressionResult>

type SpectralSessionInternals = {
  startSelectedSpectralOptimization(): Promise<void>
  waitForSelectedSpectralOptimization(): Promise<void>
}

let root = ''
let workspacePath = ''
const sessions: UploadSession[] = []

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-session-spectrals-'))
  workspacePath = join(root, 'release')
  await mkdir(workspacePath)
  await mkdir(join(root, 'Spectrals'))
  await Promise.all([
    writeFile(join(workspacePath, '01.flac'), ''),
    writeFile(join(workspacePath, '02.flac'), ''),
    writeFile(join(root, 'Spectrals', '01 Full.png'), 'full one'),
    writeFile(join(root, 'Spectrals', '01 Zoom.png'), 'zoom one'),
    writeFile(join(root, 'Spectrals', '02 Full.png'), 'full two'),
    writeFile(join(root, 'Spectrals', '02 Zoom.png'), 'zoom two')
  ])
})

afterEach(async () => {
  for (const session of sessions) session.cancelAll()
  sessions.length = 0
  await rm(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('UploadSession spectral optimization', () => {
  it('starts selected optimization after Continue without blocking navigation', async () => {
    const release = deferred()
    const calls: string[][] = []
    const session = newSession(async (paths) => {
      calls.push(paths)
      await release.promise
      return success(paths)
    }, [2])

    try {
      await expect(session.setCurrentStep(stepIndex('metadata')!)).resolves.toEqual({ ok: true })
      expect(session.getState().currentStep).toBe(stepIndex('metadata'))
      await vi.waitFor(() => expect(calls).toHaveLength(1))
      expect(calls[0]!.map((path) => basename(path))).toEqual(['02 Full.png', '02 Zoom.png'])
    } finally {
      release.resolve()
    }
  })

  it('waits for the active job and later runs only newly selected files', async () => {
    const firstRelease = deferred()
    const calls: string[][] = []
    const session = newSession(async (paths) => {
      calls.push(paths)
      if (calls.length === 1) await firstRelease.promise
      return success(paths)
    }, [1])
    const internals = session as unknown as SpectralSessionInternals

    const first = internals.startSelectedSpectralOptimization()
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    let finished = false
    const waiting = internals.waitForSelectedSpectralOptimization().then(() => {
      finished = true
    })
    await Promise.resolve()
    expect(finished).toBe(false)

    firstRelease.resolve()
    await Promise.all([first, waiting])
    session.setSpectralIds([1, 2])
    await internals.waitForSelectedSpectralOptimization()

    expect(calls).toHaveLength(2)
    expect(calls[1]!.map((path) => basename(path))).toEqual(['02 Full.png', '02 Zoom.png'])
  })

  it('does not let a cancelled job mark files as checked', async () => {
    const firstRelease = deferred()
    const calls: string[][] = []
    const session = newSession(async (paths) => {
      calls.push(paths)
      if (calls.length === 1) await firstRelease.promise
      return success(paths)
    }, [1])
    const internals = session as unknown as SpectralSessionInternals

    const stale = internals.startSelectedSpectralOptimization()
    await vi.waitFor(() => expect(calls).toHaveLength(1))
    session.cancelAll()
    firstRelease.resolve()
    await stale

    await internals.waitForSelectedSpectralOptimization()
    expect(calls).toHaveLength(2)
    expect(calls[1]!.map((path) => basename(path))).toEqual(['01 Full.png', '01 Zoom.png'])
  })

  it('cancels obsolete work when the current selection is empty', async () => {
    let activeSignal: AbortSignal | undefined
    const started = deferred()
    const session = newSession(async (paths, options) => {
      activeSignal = options?.signal
      started.resolve()
      await new Promise<void>((resolve) => {
        options?.signal?.addEventListener('abort', () => resolve(), { once: true })
      })
      return success(paths)
    }, [1])
    const internals = session as unknown as SpectralSessionInternals

    const obsolete = internals.startSelectedSpectralOptimization()
    await started.promise
    session.setSpectralIds([])
    await internals.waitForSelectedSpectralOptimization()
    await obsolete

    expect(activeSignal?.aborted).toBe(true)
  })
})

function newSession(optimizeSpectralPngs: Optimizer, selectedIds: number[]): UploadSession {
  const session = new UploadSession({
    userDataPath: root,
    getConfig: defaultConfig,
    tools: automaticToolResolver,
    send: () => undefined,
    optimizeSpectralPngs
  })
  sessions.push(session)

  let state = selectSourcePath(newState(), join(root, 'source'))
  state = setWorkspacePath(state, workspacePath)
  state = setSourceMedia(state, 'WEB')
  state = setSpectralIds(state, selectedIds)
  state = setCurrentStep(state, stepIndex('spectrals')!)
  state = {
    ...state,
    background: {
      ...state.background,
      tasks: state.background.tasks.map((task) =>
        task.id === 'spectrals' ? { ...task, status: 'succeeded' } : task
      )
    }
  }
  setState(session, state)
  return session
}

function setState(session: UploadSession, state: State): void {
  const runtime = (session as unknown as { runtime: { apply: (next: State) => void } }).runtime
  runtime.apply(state)
}

function success(paths: string[]): SpectralCompressionResult {
  return { checkedPaths: [...paths], optimizedPaths: [], failures: [] }
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
