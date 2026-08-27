export const SPECTRAL_PLACEHOLDER =
  '[hide=Spectrals]\nSpectral images will be hosted and inserted at submit time.\n[/hide]\n'

export function substituteSpectralBbcode(description: string, bbcode: string): string {
  if (!description.includes(SPECTRAL_PLACEHOLDER)) return description
  return description.replace(SPECTRAL_PLACEHOLDER, bbcode)
}

/** Hide the submit-time marker when the user chose not to host any spectrals. */
export function spectralDescriptionPreview(
  description: string,
  selectedIds: readonly number[]
): string {
  return selectedIds.length === 0 ? substituteSpectralBbcode(description, '') : description
}
