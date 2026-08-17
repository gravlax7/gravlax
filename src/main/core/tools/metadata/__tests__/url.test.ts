import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import { fetchNormalizedRelease } from '../release'
import { resolveMetadataUrl } from '../search'

const MBID = '88e95ea5-b609-4f8b-b0cb-69896eef2f47'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('resolveMetadataUrl', () => {
  it.each([
    `https://musicbrainz.org/release/${MBID}`,
    `http://www.musicbrainz.org/release/${MBID}/?foo=bar#tracks`,
    `https://musicbrainz.org/release/${MBID.toUpperCase()}`
  ])('resolves a MusicBrainz release URL: %s', (url) => {
    expect(resolveMetadataUrl(defaultConfig(), `  ${url}  `)).toEqual({
      ok: true,
      selection: {
        provider: 'MusicBrainz',
        releaseId: JSON.stringify(MBID),
        url: `https://musicbrainz.org/release/${MBID}`
      }
    })
  })

  it.each([
    'https://www.deezer.com/album/99',
    'http://deezer.com/fr/album/99/',
    'https://www.deezer.com/en-US/album/99?utm_source=test#details'
  ])('resolves a Deezer album URL: %s', (url) => {
    expect(resolveMetadataUrl(defaultConfig(), url)).toEqual({
      ok: true,
      selection: {
        provider: 'Deezer',
        releaseId: JSON.stringify('99'),
        url: 'https://www.deezer.com/album/99'
      }
    })
  })

  it('allows a direct URL when its search provider is disabled', () => {
    const cfg = defaultConfig()
    cfg.metadataProviders.deezer.enabled = false
    expect(resolveMetadataUrl(cfg, 'https://www.deezer.com/album/99').ok).toBe(true)
  })

  it('loads and normalizes a resolved release through the selected provider', async () => {
    const fetchMock = vi.fn(async (_input: string | URL | Request) => ({
      status: 200,
      ok: true,
      text: async () =>
        JSON.stringify({
          id: MBID,
          title: 'Resolved Album',
          'artist-credit': [{ name: 'Resolved Artist', artist: { name: 'Resolved Artist' } }]
        }),
      headers: { getSetCookie: () => [] }
    }))
    vi.stubGlobal('fetch', fetchMock)

    const cfg = defaultConfig()
    const resolved = resolveMetadataUrl(cfg, `https://musicbrainz.org/release/${MBID}`)
    if (!resolved.ok) throw new Error(resolved.error)
    const release = await fetchNormalizedRelease(
      cfg,
      resolved.selection.provider ?? '',
      resolved.selection.releaseId ?? '',
      resolved.selection.url ?? ''
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(`/ws/2/release/${MBID}`)
    expect(release.title).toBe('Resolved Album')
    expect(release.urls).toEqual([`https://musicbrainz.org/release/${MBID}`])
  })

  it.each([
    '',
    'not a url',
    'ftp://musicbrainz.org/release/88e95ea5-b609-4f8b-b0cb-69896eef2f47',
    'https://musicbrainz.org/release-group/88e95ea5-b609-4f8b-b0cb-69896eef2f47',
    'https://musicbrainz.org/release/not-a-uuid',
    'https://musicbrainz.org.evil.test/release/88e95ea5-b609-4f8b-b0cb-69896eef2f47',
    'https://user:pass@musicbrainz.org/release/88e95ea5-b609-4f8b-b0cb-69896eef2f47',
    'https://musicbrainz.org:444/release/88e95ea5-b609-4f8b-b0cb-69896eef2f47',
    'https://www.deezer.com/track/99',
    'https://www.deezer.com/playlist/99',
    'https://www.deezer.com/album/not-a-number',
    'https://deezer.page.link/example',
    'https://www.deezer.com.evil.test/album/99'
  ])('rejects an unsupported URL: %s', (url) => {
    expect(resolveMetadataUrl(defaultConfig(), url)).toEqual({
      ok: false,
      error: 'Enter a supported release URL.'
    })
  })
})
