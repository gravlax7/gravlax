import type { Release } from '@shared/types'
import { isMultiDiscTracks } from './editor'

/** Tags every upload needs: album, and per track a title, artist and number. */
export function missingRequiredTags(release: Release | undefined): string[] {
  const tracks = release?.tracks ?? []
  if (tracks.length === 0) return []
  const errors = release?.title?.trim() ? [] : ['The album has no title.']
  const multiDisc = isMultiDiscTracks(tracks)
  for (const [index, track] of tracks.entries()) {
    const number = track.trackNumber?.trim() || String(index + 1)
    const name = `Track ${multiDisc ? `${track.discNumber?.trim() || '1'}-${number}` : number}`
    if (!track.title?.trim()) errors.push(`${name} has no title.`)
    const hasArtist = (track.artists ?? []).some((artist) =>
      ['main', 'conductor'].includes(artist.role || 'main') && artist.name?.trim()
    )
    if (!hasArtist) errors.push(`${name} has no artist.`)
    if (tracks.length > 1 && !track.trackNumber?.trim()) errors.push(`${name} has no track number.`)
  }
  return errors
}
