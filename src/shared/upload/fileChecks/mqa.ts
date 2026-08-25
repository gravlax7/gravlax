import type { FileChecksSnapshot } from '../../types/upload'
import type { CheckTone } from './types'

export function mqaHeadline(fileChecks: FileChecksSnapshot): string | null {
  const mqa = fileChecks.mqa
  if (mqa.checkedCount === 0) return 'No FLAC files for MQA checks'
  if (mqa.mqaPaths.length > 0) return 'MQA detected'
  return 'No MQA markers found'
}

export function mqaTone(fileChecks: FileChecksSnapshot): CheckTone {
  const mqa = fileChecks.mqa
  if (mqa.mqaPaths.length > 0) return 'warning'
  if (mqa.checkedCount === 0) return 'info'
  return 'success'
}
