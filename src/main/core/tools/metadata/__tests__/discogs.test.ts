import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import { finalizeNormalizedRelease } from '../normalization'
import { createDiscogsProvider } from '../discogs'
import { createProviders, providerDefinitions } from '../providers'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubJSON(payload: unknown, status = 200) {
  const fetchMock = vi.fn(
    async (_input: string | URL | Request, _init?: RequestInit) => ({
      status,
      ok: status >= 200 && status < 300,
      text: async () => JSON.stringify(payload),
      headers: { getSetCookie: () => [] }
    })
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('Discogs provider', () => {
  it('registers after the existing providers and stays inactive by default', () => {
    const config = defaultConfig()

    expect(providerDefinitions(config)).toEqual([
      { name: 'MusicBrainz', enabled: true },
      { name: 'Deezer', enabled: true },
      { name: 'Bandcamp', enabled: true },
      { name: 'Discogs', enabled: false }
    ])
    expect(createProviders(config).map((provider) => provider.name)).toEqual([
      'MusicBrainz',
      'Deezer',
      'Bandcamp',
      'Discogs'
    ])
  })

  it('searches releases with auth, edition data, source, and collection status', async () => {
    const fetchMock = stubJSON({
      results: [
        {
          id: 432932,
          title: 'Four Tet - Rounds',
          year: 2003,
          format: ['Vinyl', 'LP', 'Album', 'Reissue'],
          label: ['Domino'],
          catno: 'WIGLP126',
          user_data: { in_collection: true }
        }
      ]
    })
    const provider = createDiscogsProvider('secret-token', 5000)

    const results = await provider.searchReleases('Four Tet Rounds', 10)

    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({
      id: 432932,
      ident: {
        artist: 'Four Tet',
        album: 'Rounds',
        year: 2003,
        source: 'Vinyl'
      }
    })
    expect(results[0]?.display).toContain('{Vinyl, LP, Album, Reissue}')
    expect(results[0]?.display).toContain('2003 Vinyl Domino WIGLP126')
    expect(results[0]?.display).toContain('IN COLLECTION')

    const [requestURL, init] = fetchMock.mock.calls[0] ?? []
    const url = new URL(String(requestURL))
    expect(url.pathname).toBe('/database/search')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'Four Tet Rounds',
      type: 'release',
      per_page: '50'
    })
    expect(url.searchParams.has('token')).toBe(false)
    expect(new Headers(init?.headers).get('Authorization')).toBe(
      'Discogs token=secret-token'
    )
  })

  it('limits results and maps File releases to WEB', async () => {
    stubJSON({
      results: [
        { id: 1, title: 'Artist - First', format: ['File', 'FLAC'], label: [] },
        { id: 2, title: 'Artist - Second', format: ['CD'], label: [] }
      ]
    })
    const provider = createDiscogsProvider('token', 5000)

    const results = await provider.searchReleases('Artist', 1)

    expect(results).toHaveLength(1)
    expect(results[0]?.ident.source).toBe('WEB')
    expect(results[0]?.display).toContain('Not On Label')
  })

  it('fetches a release by ID and omits auth when no token is set', async () => {
    const fetchMock = stubJSON({ id: 432932, title: 'Rounds' })
    const provider = createDiscogsProvider('', 5000)

    await provider.fetchData('https://www.discogs.com/release/432932', null)

    const [requestURL, init] = fetchMock.mock.calls[0] ?? []
    expect(String(requestURL)).toBe('https://api.discogs.com/releases/432932')
    expect(new Headers(init?.headers).has('Authorization')).toBe(false)
  })

  it('uses an authenticated release search for health checks', async () => {
    const fetchMock = stubJSON({ results: [] })
    const provider = createDiscogsProvider('token', 5000)

    await provider.healthcheck()

    const [requestURL, init] = fetchMock.mock.calls[0] ?? []
    const url = new URL(String(requestURL))
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      q: 'test',
      type: 'release',
      per_page: '1'
    })
    expect(new Headers(init?.headers).get('Authorization')).toBe('Discogs token=token')
  })

  it('maps release fields, discs, artist cleanup, roles, and remix titles', () => {
    const provider = createDiscogsProvider('token', 5000)
    const rawTracks: Array<Record<string, unknown>> = Array.from(
      { length: 8 },
      (_, index) => ({
      type_: 'track',
      position: index < 4 ? `A${index + 1}` : `B${index - 3}`,
      title: `Track ${index + 1}`
      })
    )
    rawTracks[0]!.extraartists = [{ name: 'Mixer (3)*', role: 'Remix' }]
    rawTracks[1]!.artists = [{ name: 'Producer (4)*' }]
    rawTracks[1]!.extraartists = [{ name: 'Producer (4)*', role: 'Producer' }]
    rawTracks.splice(4, 0, { type_: 'heading', position: '', title: 'Disc Two' })

    const release = finalizeNormalizedRelease(
      provider.mapRelease(
        {
          title: 'Rounds',
          year: 2003,
          artists: [{ name: 'Four Tet (2)*' }],
          genres: ['Electronic', 'Electronic'],
          images: [{ resource_url: 'https://img.discogs.test/cover.jpg' }],
          labels: [{ name: 'Domino', catno: 'WIGCD126' }],
          formats: [{ descriptions: ['Album', 'Reissue', 'Limited Edition'] }],
          tracklist: rawTracks
        },
        'https://www.discogs.com/release/432932'
      )
    )

    expect(release).toMatchObject({
      title: 'Rounds',
      year: '2003',
      groupYear: '2003',
      editionTitle: 'Reissue / Limited Edition',
      label: 'Domino',
      catNo: 'WIGCD126',
      releaseType: 'Album',
      cover: 'https://img.discogs.test/cover.jpg',
      trackCount: 8,
      comment: 'Discogs'
    })
    expect(release.genres).toEqual(['Electronic'])
    expect(release.albumArtist).toBe('Four Tet')
    expect(release.tracks?.[0]).toMatchObject({
      discNumber: '1',
      trackNumber: 'A1',
      title: 'Track 1 (Mixer Remix)'
    })
    expect(release.tracks?.[0]?.artists).toEqual([
      { name: 'Four Tet', role: 'main' },
      { name: 'Mixer', role: 'remixer' }
    ])
    expect(release.tracks?.[1]?.artists).toEqual([{ name: 'Producer', role: 'producer' }])
    expect(release.tracks?.[4]?.discNumber).toBe('2')
  })
})
