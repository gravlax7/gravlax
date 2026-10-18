import type { FileChecksSnapshot, UploadSnapshot } from '../../types/upload'
import type { CheckTone } from './types'

export const MQA_NOTE =
  'Say the highest unfolded resolution in the release description. For web sources, ' +
  'name the service. Gravlax cannot check either.'

export function validateMqaEditionTitle(
  fileChecks: Pick<FileChecksSnapshot, 'mqa'>,
  upload: Pick<UploadSnapshot, 'remasterTitle'>
): string | null {
  if (fileChecks.mqa.mqaPaths.length === 0) return null
  if (/mqa/i.test(upload.remasterTitle ?? '')) return null
  return 'MQA files found. Add “MQA” to the edition title.'
}

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
