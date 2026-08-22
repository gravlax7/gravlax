import { chmod, mkdtemp, rename, rm, stat, utimes } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { IntegrityIssue, IntegritySummary } from '@shared/types'
import { automaticToolResolver, type ToolResolver } from '../tools/binaries'
import { discoverFLACFiles } from '../tools/flacFiles'
import { runCommand } from '../tools/runCommand'

type CommandRunner = typeof runCommand

interface IntegrityOptions {
  signal?: AbortSignal
  tools?: ToolResolver
  run?: CommandRunner
  onProgress?: (current: number, total: number, label: string) => void
}

interface RepairOptions extends IntegrityOptions {
  onRepairStarting?: () => void | Promise<void>
  repair?: (
    path: string,
    options: { signal?: AbortSignal; tools?: ToolResolver; run?: CommandRunner }
  ) => Promise<void>
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function checkFLACIntegrity(
  path: string,
  options: Pick<IntegrityOptions, 'signal' | 'tools' | 'run'> = {}
): Promise<void> {
  await (options.run ?? runCommand)(
    'flac',
    ['-wt', '--silent', path],
    options.signal,
    undefined,
    options.tools ?? automaticToolResolver
  )
}

export async function checkFLACIntegrityWorkspace(
  root: string,
  options: IntegrityOptions = {}
): Promise<IntegritySummary> {
  if (!root) throw new Error('workspace path is required')
  const files = await discoverFLACFiles(root)
  if (files.length === 0) {
    return {
      status: 'failed',
      checkedCount: 0,
      failures: [],
      repairedPaths: [],
      repairErrors: [],
      error: 'No FLAC files found.'
    }
  }

  const failures: IntegrityIssue[] = []
  options.onProgress?.(0, files.length, 'Checking FLAC integrity…')
  for (let index = 0; index < files.length; index++) {
    options.signal?.throwIfAborted()
    const file = files[index]!
    options.onProgress?.(index, files.length, file.relativePath)
    try {
      await checkFLACIntegrity(file.absolutePath, options)
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error
      failures.push({ relativePath: file.relativePath, message: messageFrom(error) })
    }
    options.onProgress?.(index + 1, files.length, file.relativePath)
  }

  return {
    status: failures.length === 0 ? 'passed' : 'failed',
    checkedCount: files.length,
    failures,
    repairedPaths: [],
    repairErrors: []
  }
}

export async function repairFLACIntegrity(
  path: string,
  options: Pick<RepairOptions, 'signal' | 'tools' | 'run'> = {}
): Promise<void> {
  const sourceInfo = await stat(path)
  const workDir = await mkdtemp(join(dirname(path), '.gravlax-integrity-'))
  const temporary = join(workDir, basename(path))
  const run = options.run ?? runCommand
  const tools = options.tools ?? automaticToolResolver
  try {
    await run(
      'flac',
      ['-8', '-V', '--silent', path, '-o', temporary],
      options.signal,
      undefined,
      tools
    )
    await checkFLACIntegrity(temporary, { ...options, run, tools })
    await chmod(temporary, sourceInfo.mode)
    await utimes(temporary, sourceInfo.atime, sourceInfo.mtime)
    options.signal?.throwIfAborted()
    await rename(temporary, path)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

export async function repairFLACIntegrityWorkspace(
  root: string,
  options: RepairOptions = {}
): Promise<IntegritySummary> {
  const before = await checkFLACIntegrityWorkspace(root, options)
  if (before.status === 'passed' || before.failures.length === 0) return before

  const files = await discoverFLACFiles(root)
  const byRelativePath = new Map(files.map((file) => [file.relativePath, file.absolutePath]))
  const repairedPaths: string[] = []
  const repairErrors: IntegrityIssue[] = []
  const repair = options.repair ?? repairFLACIntegrity
  await options.onRepairStarting?.()
  options.signal?.throwIfAborted()
  options.onProgress?.(0, before.failures.length, 'Repairing failed FLACs…')
  for (let index = 0; index < before.failures.length; index++) {
    options.signal?.throwIfAborted()
    const failure = before.failures[index]!
    options.onProgress?.(index, before.failures.length, failure.relativePath)
    const absolutePath = byRelativePath.get(failure.relativePath)
    if (!absolutePath) {
      repairErrors.push({
        relativePath: failure.relativePath,
        message: 'The FLAC no longer exists in the working copy.'
      })
    } else {
      try {
        await repair(absolutePath, options)
        repairedPaths.push(failure.relativePath)
      } catch (error) {
        if ((error as Error).name === 'AbortError') throw error
        repairErrors.push({ relativePath: failure.relativePath, message: messageFrom(error) })
      }
    }
    options.onProgress?.(index + 1, before.failures.length, failure.relativePath)
  }

  const after = await checkFLACIntegrityWorkspace(root, options)
  return { ...after, repairedPaths, repairErrors }
}

export function integritySummaryDetail(summary: IntegritySummary): string {
  if (summary.status === 'passed') {
    const repaired = summary.repairedPaths.length > 0
      ? ` Repaired ${summary.repairedPaths.length}.`
      : ''
    return `Checked ${summary.checkedCount} FLAC file${summary.checkedCount === 1 ? '' : 's'}. All passed.${repaired}`
  }
  const lines = [
    summary.error ??
      `Checked ${summary.checkedCount} FLAC file${summary.checkedCount === 1 ? '' : 's'}. ${summary.failures.length} failed integrity.`
  ]
  for (const failure of summary.failures) {
    lines.push(`- ${failure.relativePath}: ${failure.message}`)
  }
  if (summary.repairErrors.length > 0) {
    lines.push(`Repair errors (${summary.repairErrors.length}):`)
    for (const failure of summary.repairErrors) {
      lines.push(`- ${failure.relativePath}: ${failure.message}`)
    }
  }
  return lines.join('\n')
}
