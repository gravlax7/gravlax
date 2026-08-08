import type { FilesCheckSnapshot, LogCheck } from '../types/upload'

export type CheckTone = 'success' | 'warning' | 'info'

export interface LogScore {
  tracker: string
  fileName: string
  score: number
}

export function mqaHeadline(filesCheck: FilesCheckSnapshot): string | null {
  const mqa = filesCheck.mqa
  if (mqa.checkedCount === 0) return 'No FLAC files for MQA checks'
  if (mqa.mqaPaths.length > 0) return 'MQA detected'
  return 'No MQA markers found'
}

export function mqaTone(filesCheck: FilesCheckSnapshot): CheckTone {
  const mqa = filesCheck.mqa
  if (mqa.mqaPaths.length > 0) return 'warning'
  if (mqa.checkedCount === 0) return 'info'
  return 'success'
}

/** One row per successful log check, for the per-file score list. */
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
  return filesCheck.logs.checks.some((c) => Boolean(c.error))
}

/** An imperfect score or a listed issue — a problem with the rip, not the check. */
export function hasLogIssues(filesCheck: FilesCheckSnapshot): boolean {
  return filesCheck.logs.checks.some(
    (c) => !c.error && ((c.score !== undefined && c.score < 100) || c.issues.length > 0)
  )
}

export function logHeadline(filesCheck: FilesCheckSnapshot): string {
  if (hasLogErrors(filesCheck)) return 'Logchecker errors'
  const scores = logScores(filesCheck)
  if (scores.length === 0) {
    return filesCheck.logs.skippedReason ? 'Logchecker skipped' : 'Logchecker complete'
  }
  if (scores.every((s) => s.score === 100) && !hasLogIssues(filesCheck)) {
    return 'Perfect log scores'
  }
  return 'Log score issues'
}

export function logTone(filesCheck: FilesCheckSnapshot): CheckTone {
  if (hasLogErrors(filesCheck) || hasLogIssues(filesCheck)) return 'warning'
  const scores = logScores(filesCheck)
  if (scores.length > 0 && scores.every((s) => s.score === 100)) return 'success'
  return 'info'
}

/** Whether the logchecker section is worth rendering at all. */
export function hasLogResults(filesCheck: FilesCheckSnapshot): boolean {
  return filesCheck.logs.checks.length > 0 || Boolean(filesCheck.logs.skippedReason)
}

function fileNameOf(relativePath: string): string {
  return relativePath.includes('/')
    ? relativePath.slice(relativePath.lastIndexOf('/') + 1)
    : relativePath
}

export type { LogCheck }
