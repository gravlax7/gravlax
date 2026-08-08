import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { LogCheck, LogcheckerSummary, SourceMedia } from '@shared/types'
import type { Tracker } from '@main/core/tools/trackers'
import { discoverLogFiles } from './sourceMedia'

export type { LogCheck, LogcheckerSummary }

export async function checkLogsWorkspace(
  workspacePath: string,
  options: {
    sourceMedia: SourceMedia | ''
    trackers: Tracker[]
    signal?: AbortSignal
  }
): Promise<LogcheckerSummary> {
  if (options.sourceMedia !== 'CD') {
    return { logFiles: [], checks: [], skippedReason: 'Logchecker runs for CD releases only.' }
  }
  if (!workspacePath) {
    throw new Error('workspace path is required')
  }
  if (options.trackers.length === 0) {
    return {
      logFiles: [],
      checks: [],
      skippedReason: 'No trackers enabled; skipped logchecker.'
    }
  }

  const logs = await discoverLogFiles(workspacePath)
  if (logs.length === 0) {
    return {
      logFiles: [],
      checks: [],
      skippedReason: 'No .log files found for logchecker.'
    }
  }

  const checks: LogCheck[] = []
  for (const log of logs) {
    options.signal?.throwIfAborted()
    const data = await readFile(log.absolutePath)
    for (const tracker of options.trackers) {
      options.signal?.throwIfAborted()
      const where = {
        relativePath: log.relativePath,
        trackerId: tracker.id,
        trackerName: tracker.name
      }
      try {
        const result = await tracker.client.checkLog(
          { log: { data, filename: basename(log.absolutePath) } },
          options.signal
        )
        checks.push({
          ...where,
          score: result.score,
          checksum: result.checksum ? String(result.checksum) : undefined,
          issues: result.issues ?? []
        })
      } catch (err) {
        if ((err as Error).name === 'AbortError') throw err
        checks.push({
          ...where,
          issues: [],
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }
  }

  return {
    logFiles: logs.map((l) => l.relativePath),
    checks
  }
}

export function logcheckerSummaryDetail(summary: LogcheckerSummary): string {
  if (summary.skippedReason) {
    return summary.skippedReason
  }
  if (summary.logFiles.length === 0 && summary.checks.length === 0) {
    return ''
  }

  const lines: string[] = [
    `Logchecker: checked ${summary.logFiles.length} log file${summary.logFiles.length === 1 ? '' : 's'} across enabled trackers.`
  ]

  for (const check of summary.checks) {
    if (check.error) {
      lines.push(`- ${check.relativePath} @ ${check.trackerName}: error — ${check.error}`)
      continue
    }
    if (check.score === undefined) {
      lines.push(`- ${check.relativePath} @ ${check.trackerName}: no result`)
      continue
    }
    const checksum = check.checksum ? ` (${check.checksum})` : ''
    lines.push(`- ${check.relativePath} @ ${check.trackerName}: score ${check.score}${checksum}`)
    for (const issue of check.issues) {
      lines.push(`  - ${issue}`)
    }
  }

  return lines.join('\n')
}

export function logcheckerHasIssues(summary: LogcheckerSummary): boolean {
  return summary.checks.some((check) => {
    if (check.error) return true
    if (check.score === undefined) return false
    return check.score < 100 || check.issues.length > 0
  })
}
