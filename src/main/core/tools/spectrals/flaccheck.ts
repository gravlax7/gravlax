import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative, sep } from 'node:path'
import type {
  FlaccheckFileResult,
  FlaccheckHiresVerdict,
  FlaccheckSummary,
  FlaccheckVerdict
} from '@shared/types'
import { isFakeHires } from '@shared/upload/flaccheck'
import { automaticToolResolver, type ToolId, type ToolResolver } from '@main/core/tools/binaries'
import { runCommand } from '@main/core/tools/runCommand'

const VERDICTS = new Set<string>(['GENUINE', 'SUSPICIOUS', 'TRANSCODED', 'INCONCLUSIVE'])
const HIRES_VERDICTS = new Set<string>(['GENUINE_HIRES', 'UPSAMPLED', 'PADDED_DEPTH', 'UNKNOWN'])

type CommandRunner = (name: ToolId, args: string[], signal?: AbortSignal) => Promise<Buffer>

export function emptyFlaccheckSummary(): FlaccheckSummary {
  return { status: 'idle', checkedCount: 0, files: [] }
}

export async function isFlaccheckAvailable(
  tools: ToolResolver = automaticToolResolver
): Promise<boolean> {
  return (await tools.resolve('flaccheck')).status === 'available'
}

export async function runFlaccheck(
  workspacePath: string,
  signal?: AbortSignal,
  tools: ToolResolver = automaticToolResolver,
  run: CommandRunner = (name, args, commandSignal) =>
    runCommand(name, args, commandSignal, undefined, tools)
): Promise<FlaccheckSummary> {
  if (!workspacePath) {
    return { status: 'failed', checkedCount: 0, files: [], message: 'workspace path is required' }
  }
  if (!(await isFlaccheckAvailable(tools))) {
    return { status: 'skipped', checkedCount: 0, files: [] }
  }

  const dir = await mkdtemp(join(tmpdir(), 'gravlax-flaccheck-'))
  const outputPath = join(dir, 'results.json')
  try {
    await run(
      'flaccheck',
      ['scan', workspacePath, '--format', 'json', '--quiet', '-o', outputPath],
      signal
    )
    const raw = await readFile(outputPath, 'utf8')
    const files = parseFlaccheckJson(raw, workspacePath)
    return { status: 'ok', checkedCount: files.length, files }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    return {
      status: 'failed',
      checkedCount: 0,
      files: [],
      message: String(err)
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

export function parseFlaccheckJson(raw: string, workspacePath: string): FlaccheckFileResult[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    throw new Error('flaccheck returned invalid JSON')
  }

  const rows = extractResultRows(data)
  const files: FlaccheckFileResult[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const record = row as Record<string, unknown>
    const absolute = String(record.path ?? record.file ?? '')
    const verdictRaw = String(record.transcode_verdict ?? record.verdict ?? '').toUpperCase()
    if (!absolute || !VERDICTS.has(verdictRaw)) continue
    files.push({
      path: toRelativePath(workspacePath, absolute),
      verdict: verdictRaw as FlaccheckVerdict,
      hiresVerdict: parseHiresVerdict(record.hires_verdict)
    })
  }
  files.sort((a, b) => a.path.localeCompare(b.path))
  return files
}

export function flaccheckSummaryDetail(summary: FlaccheckSummary): string {
  if (summary.status === 'skipped' || summary.status === 'idle') {
    return ''
  }
  if (summary.status === 'failed') {
    const message = summary.message?.trim() || 'unknown error'
    return `flaccheck: check failed (${message})`
  }

  const transcoded = summary.files.filter((f) => f.verdict === 'TRANSCODED')
  const suspiciousLossy = summary.files.filter(
    (f) => f.verdict === 'SUSPICIOUS' && !isFakeHires(f)
  )
  const padded = summary.files.filter((f) => f.hiresVerdict === 'PADDED_DEPTH')
  const upsampled = summary.files.filter((f) => f.hiresVerdict === 'UPSAMPLED')

  const parts: string[] = []
  if (transcoded.length > 0) {
    parts.push(`${transcoded.length} likely transcoded`)
  }
  if (suspiciousLossy.length > 0) {
    parts.push(`${suspiciousLossy.length} suspicious`)
  }
  if (padded.length > 0) {
    parts.push(`${padded.length} padded bit depth`)
  }
  if (upsampled.length > 0) {
    parts.push(`${upsampled.length} upsampled`)
  }

  if (parts.length === 0) {
    return 'flaccheck: no lossy transcode indicators.'
  }
  return `flaccheck: ${parts.join(', ')}.`
}

function parseHiresVerdict(value: unknown): FlaccheckHiresVerdict {
  const raw = String(value ?? '').toUpperCase()
  if (HIRES_VERDICTS.has(raw)) return raw as FlaccheckHiresVerdict
  return 'UNKNOWN'
}

function extractResultRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data
  if (data && typeof data === 'object') {
    const results = (data as { results?: unknown }).results
    if (Array.isArray(results)) return results
  }
  return []
}

function toRelativePath(workspacePath: string, absolutePath: string): string {
  const rel = relative(workspacePath, absolutePath)
  if (!rel || rel.startsWith('..')) {
    return absolutePath.split(sep).join('/')
  }
  return rel.split(sep).join('/')
}
