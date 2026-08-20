import type { FilesCheckSnapshot, UploadFlowStateJSON } from '../../types/upload'
import type { CheckTone } from './types'

export function integrityHeadline(filesCheck: FilesCheckSnapshot): string {
  const integrity = filesCheck.integrity
  if (integrity.status === 'passed') {
    if (integrity.repairedPaths.length > 0) {
      return `FLAC integrity passed after repairing ${integrity.repairedPaths.length}`
    }
    return `FLAC integrity passed (${integrity.checkedCount})`
  }
  if (integrity.error) return integrity.error
  if (integrity.failures.length === 1) return 'One FLAC failed integrity'
  return `${integrity.failures.length} FLACs failed integrity`
}

export function integrityTone(filesCheck: FilesCheckSnapshot): CheckTone {
  if (filesCheck.integrity.status === 'passed') return 'success'
  if (filesCheck.integrity.status === 'failed') return 'warning'
  return 'info'
}

export function flacIntegrityRepairAllowed(
  state: Pick<UploadFlowStateJSON, 'upload' | 'seed' | 'files'>
): boolean {
  const uploaded = (state.upload.submissions ?? []).some((item) => item.status === 'done')
  return !uploaded &&
    state.upload.phase !== 'submitting' &&
    state.upload.phase !== 'done' &&
    state.seed.phase === 'idle' &&
    state.files.apply.phase !== 'applying' &&
    state.files.apply.phase !== 'restoring'
}
