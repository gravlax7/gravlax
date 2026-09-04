import type { SourceRestoreUnavailableReason } from '../types/upload'

export function sourceRestoreUnavailableMessage(reason: SourceRestoreUnavailableReason): string {
  if (reason === 'moved') return 'The source folder was moved or deleted.'
  if (reason === 'changed') return 'The source folder has changed.'
  return 'This workspace cannot be restored.'
}
