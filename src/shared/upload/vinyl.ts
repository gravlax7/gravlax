import type {
  Draft,
  MetadataSearchResult,
  SourceMedia,
  VinylLineage
} from '../types/upload'

/** Where Gravlax writes pasted lineage, at the release folder root. */
export const PASTED_LINEAGE_FILE = 'lineage.txt'

export function validateVinylLineage(draft: Pick<Draft, 'sourceMedia' | 'lineage'>): string | null {
  if (draft.sourceMedia !== 'Vinyl' || draft.lineage) return null
  return 'Choose the lineage for this vinyl rip, or confirm uploading without one.'
}

/** The lineage file inside the release folder, if the lineage has one. */
export function lineageFilePath(lineage: VinylLineage | undefined): string | null {
  if (lineage?.kind === 'file') return lineage.path
  if (lineage?.kind === 'pasted') return PASTED_LINEAGE_FILE
  return null
}

/** A metadata result whose own media differs from the chosen source media. */
export function metadataMediaMismatch(
  media: SourceMedia | '',
  result: Pick<MetadataSearchResult, 'provider' | 'source'> | undefined
): string | null {
  const source = result?.source ?? ''
  if (!media || !source || source === media) return null
  if (media !== 'Vinyl' && source !== 'Vinyl') return null
  return `This ${result?.provider ?? 'metadata'} release is ${source}, but the source media is ${media}.`
}

/** A Discogs release with more tracks than the folder suggests a partial upload. */
export function vinylTrackCountNotice(
  media: SourceMedia | '',
  provider: string | undefined,
  listed: number,
  files: number
): string | null {
  if (media !== 'Vinyl' || provider !== 'Discogs' || listed <= files) return null
  return `Discogs lists ${listed} tracks, the folder has ${files}. A multi-record set must be uploaded whole, and only the vinyl part of a mixed package.`
}
