import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runCommand } from '../../tools/runCommand'
import {
  checkFLACIntegrity,
  checkFLACIntegrityWorkspace,
  repairFLACIntegrityWorkspace
} from '../integrity'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function workspace(...files: string[]): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gravlax-integrity-'))
  roots.push(root)
  for (const file of files) {
    await mkdir(join(root, file, '..'), { recursive: true })
    await writeFile(join(root, file), 'fake flac')
  }
  return root
}

describe('FLAC integrity checks', () => {
  it('checks nested FLACs with warnings treated as errors', async () => {
    const root = await workspace('CD2/02.flac', 'CD1/01.FLAC')
    const run = vi.fn<typeof runCommand>(async () => Buffer.alloc(0))
    const summary = await checkFLACIntegrityWorkspace(root, { run })

    expect(summary.status).toBe('passed')
    expect(summary.checkedCount).toBe(2)
    expect(run.mock.calls.map((call) => call[1])).toEqual([
      ['-wt', '--silent', join(root, 'CD1/01.FLAC')],
      ['-wt', '--silent', join(root, 'CD2/02.flac')]
    ])
  })

  it('keeps each failed path and command message', async () => {
    const root = await workspace('01.flac', '02.flac')
    const run = vi.fn<typeof runCommand>(async (_name, args) => {
      if (basename(args.at(-1)!) === '02.flac') throw new Error('MD5 signature was unset')
      return Buffer.alloc(0)
    })
    const summary = await checkFLACIntegrityWorkspace(root, { run })

    expect(summary.status).toBe('failed')
    expect(summary.failures).toEqual([
      { relativePath: '02.flac', message: 'MD5 signature was unset' }
    ])
  })

  it('reports an empty release as a blocking failure', async () => {
    const root = await workspace('notes.txt')
    await expect(checkFLACIntegrityWorkspace(root)).resolves.toMatchObject({
      status: 'failed',
      checkedCount: 0,
      error: 'No FLAC files found.'
    })
  })

  it('passes cancellation through without turning it into a file failure', async () => {
    const controller = new AbortController()
    const abort = new DOMException('cancelled', 'AbortError')
    const run = vi.fn<typeof runCommand>(async () => { throw abort })
    await expect(
      checkFLACIntegrity('/music/01.flac', { signal: controller.signal, run })
    ).rejects.toBe(abort)
  })
})

describe('workspace FLAC repair', () => {
  it('rescans, repairs only current failures, and checks every file again', async () => {
    const root = await workspace('01.flac', '02.flac')
    let repaired = false
    const run = vi.fn<typeof runCommand>(async (_name, args) => {
      if (basename(args.at(-1)!) === '02.flac' && !repaired) throw new Error('unset MD5')
      return Buffer.alloc(0)
    })
    const repair = vi.fn(async (_path: string) => { repaired = true })
    const onRepairStarting = vi.fn(async () => undefined)

    const summary = await repairFLACIntegrityWorkspace(root, { run, repair, onRepairStarting })

    expect(onRepairStarting).toHaveBeenCalledOnce()
    expect(onRepairStarting.mock.invocationCallOrder[0]).toBeLessThan(
      repair.mock.invocationCallOrder[0]!
    )
    expect(repair).toHaveBeenCalledOnce()
    expect(basename(repair.mock.calls[0]![0])).toBe('02.flac')
    expect(summary).toMatchObject({
      status: 'passed',
      checkedCount: 2,
      failures: [],
      repairedPaths: ['02.flac'],
      repairErrors: []
    })
    expect(run).toHaveBeenCalledTimes(4)
  })

  it('does not announce repair when every FLAC passes', async () => {
    const root = await workspace('01.flac')
    const run = vi.fn<typeof runCommand>(async () => Buffer.alloc(0))
    const onRepairStarting = vi.fn(async () => undefined)

    await repairFLACIntegrityWorkspace(root, { run, onRepairStarting })

    expect(onRepairStarting).not.toHaveBeenCalled()
  })

  it('attempts each failure once and leaves unresolved failures visible', async () => {
    const root = await workspace('01.flac')
    const run = vi.fn<typeof runCommand>(async () => { throw new Error('corrupt frame') })
    const repair = vi.fn(async (_path: string) => { throw new Error('encode failed') })

    const summary = await repairFLACIntegrityWorkspace(root, { run, repair })

    expect(repair).toHaveBeenCalledOnce()
    expect(summary.status).toBe('failed')
    expect(summary.failures).toHaveLength(1)
    expect(summary.repairErrors).toEqual([
      { relativePath: '01.flac', message: 'encode failed' }
    ])
  })
})
