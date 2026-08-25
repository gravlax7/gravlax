import type { FileChecksSnapshot, LogCheck } from '../../types/upload'
import { fileNameOf, type CheckTone } from './types'

export interface LogScore {
  tracker: string
  fileName: string
  score: number
}

export function logScores(fileChecks: FileChecksSnapshot): LogScore[] {
  const scores: LogScore[] = []
  for (const check of fileChecks.logs.checks) {
    if (check.error || check.score === undefined) continue
    scores.push({
      tracker: check.trackerName,
      fileName: fileNameOf(check.relativePath),
      score: check.score
    })
  }
  return scores
}

export function hasLogErrors(fileChecks: FileChecksSnapshot): boolean {
  return fileChecks.logs.checks.some((check) => Boolean(check.error))
}

export function hasLogIssues(fileChecks: FileChecksSnapshot): boolean {
  return fileChecks.logs.checks.some(
    (check) => !check.error &&
      ((check.score !== undefined && check.score < 100) || check.issues.length > 0)
  )
}

export function logHeadline(fileChecks: FileChecksSnapshot): string {
  if (hasLogErrors(fileChecks)) return 'Logchecker errors'
  const scores = logScores(fileChecks)
  if (scores.length === 0) {
    return fileChecks.logs.skippedReason ? 'Logchecker skipped' : 'Logchecker complete'
  }
  if (scores.every((score) => score.score === 100) && !hasLogIssues(fileChecks)) {
    return 'Perfect log scores'
  }
  return 'Log score issues'
}

export function logTone(fileChecks: FileChecksSnapshot): CheckTone {
  if (hasLogErrors(fileChecks) || hasLogIssues(fileChecks)) return 'warning'
  const scores = logScores(fileChecks)
  if (scores.length > 0 && scores.every((score) => score.score === 100)) return 'success'
  return 'info'
}

export function hasLogResults(fileChecks: FileChecksSnapshot): boolean {
  return fileChecks.logs.checks.length > 0 || Boolean(fileChecks.logs.skippedReason)
}

export type { LogCheck }
