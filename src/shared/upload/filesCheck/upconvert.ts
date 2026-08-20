import type { FilesCheckSnapshot } from '../../types/upload'
import { fileNameOf, type CheckTone } from './types'

export interface UpconvertFinding {
  fileName: string
  wastedBits: number
  bitDepth: number
}

export function upconvertFindings(filesCheck: FilesCheckSnapshot): UpconvertFinding[] {
  return filesCheck.upconvert.results
    .filter((result) => result.isUpconverted)
    .map((result) => ({
      fileName: fileNameOf(result.relativePath),
      wastedBits: result.wastedBits,
      bitDepth: result.bitDepth
    }))
}

export function hasUpconvertResults(filesCheck: FilesCheckSnapshot): boolean {
  return filesCheck.upconvert.checkedCount > 0 || filesCheck.upconvert.errors.length > 0
}

export function upconvertHeadline(filesCheck: FilesCheckSnapshot): string {
  const upconvert = filesCheck.upconvert
  const findings = upconvertFindings(filesCheck)
  if (findings.length === 1) return 'Possible 24-bit upconvert detected'
  if (findings.length > 1) return `Possible 24-bit upconverts detected (${findings.length})`
  if (upconvert.errors.length > 0) return 'Upconvert check incomplete'
  if (upconvert.checkedCount === 0) return 'No 24-bit FLAC files for upconvert checks'
  return 'No likely 24-bit upconverts found'
}

export function upconvertTone(filesCheck: FilesCheckSnapshot): CheckTone {
  const upconvert = filesCheck.upconvert
  if (upconvertFindings(filesCheck).length > 0 || upconvert.errors.length > 0) return 'warning'
  if (upconvert.checkedCount === 0) return 'info'
  return 'success'
}
