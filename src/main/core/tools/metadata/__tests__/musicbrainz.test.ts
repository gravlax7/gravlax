import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import packageJSON from '../../../../../../package.json'
import { createMusicBrainzProvider, MUSICBRAINZ_USER_AGENT } from '../musicbrainz'
import {
  MUSICBRAINZ_REQUEST_INTERVAL_MS,
  MusicBrainzRateLimiter
} from '../musicbrainzRateLimit'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('MusicBrainz provider', () => {
  it('identifies Gravlax and spaces every request by more than one second', async () => {
    const headers: Headers[] = []
    const starts: number[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        starts.push(Date.now())
        headers.push(new Headers(init?.headers))
        return new Response(JSON.stringify({ releases: [] }))
      })
    )

    const provider = createMusicBrainzProvider(5000, new MusicBrainzRateLimiter())
    const requests = [
      provider.healthcheck(),
      provider.searchReleases('Four Tet', 10),
      provider.fetchData('', '88e95ea5-b609-4f8b-b0cb-69896eef2f47')
    ]

    await vi.advanceTimersByTimeAsync(MUSICBRAINZ_REQUEST_INTERVAL_MS * 2)
    await Promise.all(requests)

    expect(headers).toHaveLength(3)
    expect(MUSICBRAINZ_USER_AGENT).toBe(
      `gravlax/${packageJSON.version} ( gravlax.unfreeze415@passfwd.com )`
    )
    for (const requestHeaders of headers) {
      expect(requestHeaders.get('User-Agent')).toBe(MUSICBRAINZ_USER_AGENT)
    }
    expect(starts[1]! - starts[0]!).toBeGreaterThan(1000)
    expect(starts[2]! - starts[1]!).toBeGreaterThan(1000)
  })

  it('asks MusicBrainz for genres when fetching a release', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        return new Response(JSON.stringify({}))
      })
    )

    const provider = createMusicBrainzProvider(5000, new MusicBrainzRateLimiter())
    const request = provider.fetchData('', '88e95ea5-b609-4f8b-b0cb-69896eef2f47')
    await vi.advanceTimersByTimeAsync(MUSICBRAINZ_REQUEST_INTERVAL_MS)
    await request

    expect(urls).toHaveLength(1)
    expect(new URL(urls[0]!).searchParams.get('inc')).toContain('genres')
  })

  it('drops an aborted queued request before it reaches MusicBrainz', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ releases: [] })))
    vi.stubGlobal('fetch', fetchMock)

    const provider = createMusicBrainzProvider(5000, new MusicBrainzRateLimiter())
    await provider.healthcheck()

    const controller = new AbortController()
    const queued = provider.searchReleases('Four Tet', 10, controller.signal)
    const rejected = expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    controller.abort()
    await vi.runAllTimersAsync()

    await rejected
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('stops queued requests after a rate-limit response', async () => {
    const fetchMock = vi.fn(async () => new Response('unavailable', { status: 503 }))
    vi.stubGlobal('fetch', fetchMock)

    const provider = createMusicBrainzProvider(5000, new MusicBrainzRateLimiter())
    const settled = Promise.allSettled([
      provider.healthcheck(),
      provider.searchReleases('Four Tet', 10),
      provider.fetchData('', '88e95ea5-b609-4f8b-b0cb-69896eef2f47')
    ])
    await vi.runAllTimersAsync()

    const results = await settled
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(results).toHaveLength(3)
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect(results[0]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: expect.stringContaining('status 503') })
    })
  })
})
