import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDeezerProvider } from '../deezer'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubJSON(payload: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status,
      ok: status >= 200 && status < 300,
      text: async () => JSON.stringify(payload),
      headers: { getSetCookie: () => [] }
    }))
  )
}

describe('Deezer provider', () => {
  it('searches albums with track counts', async () => {
    stubJSON({
      data: [
        {
          id: 99,
          title: 'There Is Love In You',
          nb_tracks: 10,
          artist: { name: 'Four Tet' }
        }
      ]
    })

    const provider = createDeezerProvider(5000)
    const results = await provider.searchReleases('Four Tet', 10)
    expect(results).toHaveLength(1)
    expect(results[0]?.ident.artist).toBe('Four Tet')
    expect(results[0]?.ident.album).toBe('There Is Love In You')
    expect(results[0]?.ident.trackCount).toBe(10)
    expect(results[0]?.ident.source).toBe('WEB')
    expect(provider.formatURL(99, '', '')).toBe('https://www.deezer.com/album/99')
  })
})
