import { afterEach, describe, expect, it, vi } from 'vitest'
import { createBandcampProvider } from '../bandcamp'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function mapHtml(html: string, url = 'https://example.bandcamp.com/album/test') {
  return createBandcampProvider(5000).mapRelease({ html }, url)
}

function stubFetch(
  impl: (input: string | URL | Request, init?: RequestInit) => Promise<{
    status: number
    ok: boolean
    text: () => Promise<string>
    headers: { getSetCookie: () => string[] }
  }>
): void {
  vi.stubGlobal('fetch', vi.fn(impl))
}

describe('Bandcamp release scrape', () => {
  it('sets catno from a slash title prefix and strips it from the title', () => {
    const release = mapHtml(`
      <div id="name-section">
        <span>Marius Acke</span>
        <div class="trackTitle">TOW014 / Marius Acke - Dirty &amp; Funky EP</div>
      </div>
      <div id="band-name-location">
        <span class="title">Theory Of Swing Records</span>
      </div>
    `)

    expect(release.title).toBe('Dirty & Funky EP')
    expect(release.catNo).toBe('TOW014')
    expect(release.label).toBe('Theory Of Swing Records')
  })

  it('recovers catno from a footer label release when the page title has none', () => {
    const release = mapHtml(`
      <div id="name-section">
        <span>Marius Acke</span>
        <div class="trackTitle">Dirty &amp; Funky EP</div>
      </div>
      <ul>
        <li
          class="recommended-album footer-ar"
          data-albumtitle="TOW014 / Marius Acke - Dirty &amp; Funky EP"
          data-artist="Marius Acke"
        ></li>
      </ul>
    `)

    expect(release.title).toBe('Dirty & Funky EP')
    expect(release.catNo).toBe('TOW014')
  })

  it('leaves slash titles without a catalog number unchanged', () => {
    const release = mapHtml(`
      <div id="name-section">
        <span>Example Artist</span>
        <div class="trackTitle">Love / Hate EP</div>
      </div>
    `)

    expect(release.title).toBe('Love / Hate EP')
    expect(release.catNo).toBe('')
  })

  it('sets catno from a bracketed prefix and cleans the title', () => {
    const release = mapHtml(`
      <div id="name-section">
        <span>Various Artists</span>
        <div class="trackTitle">[NTVA03] AFTER HOURS</div>
      </div>
      <div id="band-name-location">
        <span class="title">Native Television</span>
      </div>
    `)

    expect(release.title).toBe('AFTER HOURS')
    expect(release.catNo).toBe('NTVA03')
    expect(release.label).toBe('Native Television')
  })

  it('sets catno from a parenthesized prefix and cleans the title', () => {
    const release = mapHtml(`
      <div id="name-section">
        <span>The Magic Movement</span>
        <div class="trackTitle">(ST03) Balearic Shaketown</div>
      </div>
      <div id="band-name-location">
        <span class="title">The Magic Movement</span>
      </div>
    `)

    expect(release.title).toBe('Balearic Shaketown')
    expect(release.catNo).toBe('ST03')
    expect(release.label).toBe('')
  })

  it('recovers the release artist from a label-hosted Artist - Title heading', () => {
    const release = mapHtml(`
      <div id="name-section">
        <h2 class="trackTitle">Success - Tripwire</h2>
        <h3>by <span><a href="https://ozonerecordings1.bandcamp.com">Ozone Recordings</a></span></h3>
      </div>
      <p id="band-name-location">
        <span class="title">Ozone Recordings</span>
      </p>
      <table id="track_table">
        <tr class="track_row_view linked" rel="tracknum=1">
          <td class="track-number-col"><div class="track_number">1.</div></td>
          <td class="title-col"><span class="track-title">Tripwire (Deep Bass Strip Down Acid)</span></td>
        </tr>
        <tr class="track_row_view linked" rel="tracknum=4">
          <td class="track-number-col"><div class="track_number">4.</div></td>
          <td class="title-col"><span class="track-title">Tripwire - (Deep Space Dub)</span></td>
        </tr>
      </table>
    `)

    expect(release.title).toBe('Tripwire')
    expect(release.label).toBe('Ozone Recordings')
    expect(release.tracks?.[0]?.artists).toEqual([{ name: 'Success', role: 'main' }])
    expect(release.tracks?.[0]?.title).toBe('Tripwire (Deep Bass Strip Down Acid)')
    expect(release.tracks?.[1]?.artists).toEqual([{ name: 'Success', role: 'main' }])
    expect(release.tracks?.[1]?.title).toBe('Tripwire - (Deep Space Dub)')
  })

  it('does not split a hyphenated title without tracklist support', () => {
    const release = mapHtml(`
      <div id="name-section">
        <h2 class="trackTitle">Club Cuts - Remixes</h2>
        <h3>by <span><a href="https://example.bandcamp.com">Example Label</a></span></h3>
      </div>
      <p id="band-name-location">
        <span class="title">Example Label</span>
      </p>
      <table id="track_table">
        <tr class="track_row_view linked" rel="tracknum=1">
          <td class="track-number-col"><div class="track_number">1.</div></td>
          <td class="title-col"><span class="track-title">Sunrise Mix</span></td>
        </tr>
        <tr class="track_row_view linked" rel="tracknum=2">
          <td class="track-number-col"><div class="track_number">2.</div></td>
          <td class="title-col"><span class="track-title">Moonlight Dub</span></td>
        </tr>
      </table>
    `)

    expect(release.title).toBe('Club Cuts - Remixes')
    expect(release.label).toBe('')
  })

  it('removes various-artist track side prefixes from track artists', () => {
    const release = mapHtml(`
      <div id="name-section">
        <span>Various Artists</span>
        <div class="trackTitle">[NTVA03] AFTER HOURS</div>
      </div>
      <div id="band-name-location">
        <span class="title">Native Television</span>
      </div>
      <table id="track_table">
        <tr class="track_row_view linked" rel="tracknum=1">
          <td class="track-number-col"><div class="track_number">1.</div></td>
          <td class="title-col"><span class="track-title">A1 TUFF TRAX - DEEPER LOVE</span></td>
        </tr>
        <tr class="track_row_view linked" rel="tracknum=8">
          <td class="track-number-col"><div class="track_number">8.</div></td>
          <td class="title-col"><span class="track-title">B4 TABZ, NICKOLAI - BACK 2 BUSINESS</span></td>
        </tr>
      </table>
    `)

    expect(release.tracks?.[0]?.artists).toEqual([{ name: 'TUFF TRAX', role: 'main' }])
    expect(release.tracks?.[0]?.title).toBe('DEEPER LOVE')
    expect(release.tracks?.[1]?.artists).toEqual([
      { name: 'TABZ', role: 'main' },
      { name: 'NICKOLAI', role: 'main' }
    ])
    expect(release.tracks?.[1]?.title).toBe('BACK 2 BUSINESS')
  })

  it('parses unlinked track rows without a track-title class', () => {
    const release = mapHtml(`
      <div id="name-section">
        <span>Ladytron</span>
        <div class="trackTitle">Paradies</div>
      </div>
      <table id="track_table">
        <tr class="track_row_view linked" rel="tracknum=1">
          <td class="track-number-col"><div class="track_number">1.</div></td>
          <td class="title-col">
            <div class="title">
              <a href="/track/i-believe-in-you-2"><span class="track-title">I Believe In You</span></a>
              <span class="time secondaryText">05:02</span>
            </div>
          </td>
        </tr>
        <tr class="track_row_view" rel="tracknum=2">
          <td class="track-number-col"><div class="track_number">2.</div></td>
          <td class="title-col">
            <div class="title">
              <span>In Blood</span>
            </div>
          </td>
        </tr>
      </table>
    `)

    expect(release.tracks?.[0]?.title).toBe('I Believe In You')
    expect(release.tracks?.[1]?.title).toBe('In Blood')
  })
})

describe('Bandcamp search', () => {
  it('parses album and track search results without following redirects', async () => {
    const html = `
      <div class="result-items">
        <div class="searchresult data-search">
          <div class="result-info">
            <div class="itemurl"><a>https://fourtet.bandcamp.com/album/there-is-love-in-you</a></div>
            <div class="heading"><a>There Is Love In You</a></div>
            <div class="subhead">by Four Tet</div>
            <div class="length">10 tracks</div>
            <div class="released">released 25 January 2010</div>
          </div>
        </div>
        <div class="searchresult data-search">
          <div class="result-info">
            <div class="itemurl"><a>https://fourtet.bandcamp.com/track/angel-echoes</a></div>
            <div class="heading"><a>Angel Echoes</a></div>
            <div class="subhead">by Four Tet</div>
            <div class="length">1 track</div>
            <div class="released">released 25 January 2010</div>
          </div>
        </div>
      </div>
    `
    stubFetch(async (_input, init) => {
      expect(init?.redirect).toBe('manual')
      return {
        status: 200,
        ok: true,
        text: async () => html,
        headers: { getSetCookie: () => [] }
      }
    })

    const provider = createBandcampProvider(5000)
    const results = await provider.searchReleases('Four Tet', 10)
    expect(results).toHaveLength(2)
    expect(results[0]?.ident).toEqual({
      artist: 'Four Tet',
      album: 'There Is Love In You',
      year: 2010,
      trackCount: 10,
      source: 'WEB'
    })
    expect(results[0]?.display).toBe(
      'Four Tet - There Is Love In You {10 Tracks} 2010 fourtet'
    )
    expect(provider.formatURL(results[0]?.id, '', '')).toBe(
      'https://fourtet.bandcamp.com/album/there-is-love-in-you'
    )
    expect(results[1]?.ident.trackCount).toBe(1)
    expect(provider.formatURL(results[1]?.id, '', '')).toBe(
      'https://fourtet.bandcamp.com/track/angel-echoes'
    )
  })

  it('returns no search results when Bandcamp redirects', async () => {
    stubFetch(async () => ({
      status: 302,
      ok: false,
      text: async () => '',
      headers: { getSetCookie: () => [] }
    }))

    const results = await createBandcampProvider(5000).searchReleases('Four Tet', 10)
    expect(results).toEqual([])
  })

  it('healthchecks the search endpoint', async () => {
    stubFetch(async (input) => {
      expect(String(input)).toContain('https://bandcamp.com/search/')
      expect(String(input)).toContain('q=test')
      return {
        status: 200,
        ok: true,
        text: async () => '<html></html>',
        headers: { getSetCookie: () => [] }
      }
    })

    await expect(createBandcampProvider(5000).healthcheck()).resolves.toBeUndefined()
  })
})
