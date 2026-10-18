import type { FileChecksSnapshot } from '../../types/upload'
import { audioLimitFindings } from './audioLimits'
import { UPCONVERT_BLOCKED, upconvertsFound } from './upconvert'

/** A finding that breaks a rule and stops the upload, or null. */
export function fileChecksBlocker(fileChecks: FileChecksSnapshot): string | null {
  const limit = audioLimitFindings(fileChecks)[0]
  if (limit) return limit.detail
  if (upconvertsFound(fileChecks)) return UPCONVERT_BLOCKED
  return null
}
