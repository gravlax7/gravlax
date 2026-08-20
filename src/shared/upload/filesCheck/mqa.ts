import type { FilesCheckSnapshot } from '../../types/upload'
import type { CheckTone } from './types'

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
