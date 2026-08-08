import { extractAlbumRelease } from '@main/core/tags/extract'
import type { MetadataBaseline } from '@shared/types'
import { buildQueryStrings, cleanReleaseTitle } from '@shared/upload/dupeSearch'

export { buildQueryStrings, cleanReleaseTitle }

export async function extractSearchBaseline(workspacePath: string): Promise<MetadataBaseline> {
  const release = await extractAlbumRelease(workspacePath)
  const title = (release.title ?? '').trim()
  if (!title) {
    throw new Error(
      'metadata search requires album tags, but ALBUM is missing from the workspace FLAC files'
    )
  }

  const artists = (release.artists ?? [])
    .filter((a) => (a.role ?? 'main') === 'main' && (a.name ?? '').trim())
    .map((a) => a.name!.trim())

  const various = artists.some((a) => /various/i.test(a))
  const queryArtists = various || artists.length > 3 ? [] : artists
  const queryStrings = buildQueryStrings(queryArtists.length === 0 && various ? [] : queryArtists, title)
  if (queryStrings.length === 0) {
    throw new Error(
      'metadata search requires usable album tags, but no searchable artist/title baseline could be derived'
    )
  }

  const year = release.year ? Number(release.year) : undefined
  return {
    artists,
    title,
    year: year && Number.isFinite(year) ? year : undefined,
    label: release.label,
    catNo: release.catNo,
    upc: release.upc,
    trackCount: release.trackCount,
    queryStrings
  }
}
