import type { Draft } from '../types/upload'

export function addLossySource(comment: string, sourceUrl: string): string {
  const url = sourceUrl.trim()
  if (!url || comment.includes(url)) return comment
  return `${comment ? `${comment}\n\n` : ''}Sourced from: ${url}`
}

export function buildLossyMasterComment(input: {
  comment?: string
  spectralBbcode?: string
}): string {
  const comment = (input.comment ?? '').trim()
  const spectrals = input.spectralBbcode ?? ''
  return comment && spectrals ? `${comment}\n\n${spectrals}` : comment || spectrals
}

export function lossyMasterMissingSpectral(
  draft: Pick<Draft, 'lossyMaster' | 'spectralIds'>
): boolean {
  return draft.lossyMaster && draft.spectralIds.length === 0
}

export const LOSSY_MASTER_SPECTRAL_REQUIRED =
  'Select at least one spectral for the lossy master report.'

export function validateLossyMasterReport(
  draft: Pick<Draft, 'lossyMaster' | 'lossyComment' | 'spectralIds'>
): string | null {
  if (!draft.lossyMaster) return null
  if (lossyMasterMissingSpectral(draft)) return LOSSY_MASTER_SPECTRAL_REQUIRED
  if (!draft.lossyComment.trim()) {
    return 'Add a comment about the source to the lossy master report.'
  }
  return null
}
