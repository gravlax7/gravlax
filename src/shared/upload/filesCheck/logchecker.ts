import type { FilesCheckSnapshot, LogCheck } from '../../types/upload'
import { fileNameOf, type CheckTone } from './types'

export interface LogScore {
  tracker: string
  fileName: string
  score: number
}

export function logScores(filesCheck: FilesCheckSnapshot): LogScore[] {
  const scores: LogScore[] = []
  for (const check of filesCheck.logs.checks) {
    if (check.error || check.score === undefined) continue
    scores.push({
      tracker: check.trackerName,
      fileName: fileNameOf(check.relativePath),
      score: check.score
    })
  }
  return scores
}

export function hasLogErrors(filesCheck: FilesCheckSnapshot): boolean {
  return filesCheck.logs.checks.some((check) => Boolean(check.error))
}

export function hasLogIssues(filesCheck: FilesCheckSnapshot): boolean {
  return filesCheck.logs.checks.some(
    (check) => !check.error &&
      ((check.score !== undefined && check.score < 100) || check.issues.length > 0)
  )
}

export function logHeadline(filesCheck: FilesCheckSnapshot): string {
  if (hasLogErrors(filesCheck)) return 'Logchecker errors'
  const scores = logScores(filesCheck)
  if (scores.length === 0) {
    return filesCheck.logs.skippedReason ? 'Logchecker skipped' : 'Logchecker complete'
  }
  if (scores.every((score) => score.score === 100) && !hasLogIssues(filesCheck)) {
    return 'Perfect log scores'
  }
  return 'Log score issues'
}

export function logTone(filesCheck: FilesCheckSnapshot): CheckTone {
  if (hasLogErrors(filesCheck) || hasLogIssues(filesCheck)) return 'warning'
  const scores = logScores(filesCheck)
  if (scores.length > 0 && scores.every((score) => score.score === 100)) return 'success'
  return 'info'
}

export function hasLogResults(filesCheck: FilesCheckSnapshot): boolean {
  return filesCheck.logs.checks.length > 0 || Boolean(filesCheck.logs.skippedReason)
}

export type { LogCheck }
