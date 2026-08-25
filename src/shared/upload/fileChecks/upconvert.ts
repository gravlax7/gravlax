import type { FileChecksSnapshot } from '../../types/upload'
import { fileNameOf, type CheckTone } from './types'

export interface UpconvertFinding {
  fileName: string
  wastedBits: number
  bitDepth: number
}

export function upconvertFindings(fileChecks: FileChecksSnapshot): UpconvertFinding[] {
  return fileChecks.upconvert.results
    .filter((result) => result.isUpconverted)
    .map((result) => ({
      fileName: fileNameOf(result.relativePath),
      wastedBits: result.wastedBits,
      bitDepth: result.bitDepth
    }))
}

export function hasUpconvertResults(fileChecks: FileChecksSnapshot): boolean {
  return fileChecks.upconvert.checkedCount > 0 || fileChecks.upconvert.errors.length > 0
}

export function upconvertHeadline(fileChecks: FileChecksSnapshot): string {
  const upconvert = fileChecks.upconvert
  const findings = upconvertFindings(fileChecks)
  if (findings.length === 1) return 'Possible 24-bit upconvert detected'
  if (findings.length > 1) return `Possible 24-bit upconverts detected (${findings.length})`
  if (upconvert.errors.length > 0) return 'Upconvert check incomplete'
  if (upconvert.checkedCount === 0) return 'No 24-bit FLAC files for upconvert checks'
  return 'No likely 24-bit upconverts found'
}

export function upconvertTone(fileChecks: FileChecksSnapshot): CheckTone {
  const upconvert = fileChecks.upconvert
  if (upconvertFindings(fileChecks).length > 0 || upconvert.errors.length > 0) return 'warning'
  if (upconvert.checkedCount === 0) return 'info'
  return 'success'
}
