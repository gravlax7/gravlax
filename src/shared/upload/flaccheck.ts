import type { FlaccheckFileResult, FlaccheckSummary } from '../types/upload'

/**
 * A hi-res verdict that says the file was inflated from a smaller source —
 * padded bit depth or an upsampled rate. Says nothing about lossy encoding.
 */
export function isFakeHires(file: FlaccheckFileResult): boolean {
  return file.hiresVerdict === 'PADDED_DEPTH' || file.hiresVerdict === 'UPSAMPLED'
}

export function isLikelyLossy(file: FlaccheckFileResult): boolean {
  if (file.verdict === 'TRANSCODED') return true
  // SUSPICIOUS on a fake hi-res file is explained by the padding, so it does
  // not count as a lossy signal on its own.
  if (file.verdict === 'SUSPICIOUS' && !isFakeHires(file)) return true
  return false
}

export function flaccheckSuspectCount(flaccheck: FlaccheckSummary | undefined): number {
  return (flaccheck?.files ?? []).filter((f) => isLikelyLossy(f)).length
}

export function flaccheckHiresSuspectCount(flaccheck: FlaccheckSummary | undefined): number {
  return (flaccheck?.files ?? []).filter((f) => isFakeHires(f)).length
}
