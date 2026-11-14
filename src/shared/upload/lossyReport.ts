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

export function lossyReportPhrase(sourceMedia?: string): 'lossy WEB' | 'lossy master' {
  return sourceMedia === 'WEB' ? 'lossy WEB' : 'lossy master'
}

export function lossyReportLabel(sourceMedia?: string): string {
  const phrase = lossyReportPhrase(sourceMedia)
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

export function lossySpectralRequired(sourceMedia?: string): string {
  return `Select at least one spectral for the ${lossyReportPhrase(sourceMedia)} report.`
}

export function validateLossyMasterReport(
  draft: Pick<Draft, 'lossyMaster' | 'lossyComment' | 'spectralIds'> & {
    sourceMedia?: Draft['sourceMedia']
  }
): string | null {
  if (!draft.lossyMaster) return null
  if (lossyMasterMissingSpectral(draft)) return lossySpectralRequired(draft.sourceMedia)
  if (!draft.lossyComment.trim()) {
    return `Add a comment about the source to the ${lossyReportPhrase(draft.sourceMedia)} report.`
  }
  return null
}
