import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import {
  GazelleClient,
  RateLimiter,
  TrackerLoginError,
  TrackerRequestError,
  authHeaders,
  parseTorrentGroupIdFromUrl,
  resetTrackerRateLimiter,
  usesApiKeyAuth
} from '../gazelle'
import { ORPHEUS_RATE_LIMITS, ORPHEUS_RELEASE_TYPES } from '../orpheus'
import { REDACTED_RATE_LIMITS, REDACTED_RELEASE_TYPES } from '../redacted'

afterEach(() => {
  resetTrackerRateLimiter()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function stubFetch(
  handler: (input: string, init?: RequestInit) => Promise<{
    status: number
    url?: string
    text: string
    headers?: Record<string, string>
  }>
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string, init?: RequestInit) => {
      const result = await handler(input, init)
      return {
        status: result.status,
        ok: result.status >= 200 && result.status < 300,
        url: result.url ?? input,
        text: async () => result.text,
        headers: {
          get: (name: string) => result.headers?.[name] ?? null,
          getSetCookie: () => []
        }
      }
    })
  )
}

function client(overrides: Partial<ConstructorParameters<typeof GazelleClient>[0]> = {}) {
  return new GazelleClient({
    siteUrl: 'https://example.test/',
    announceUrl: 'https://announce.example.test/',
    apiKey: '',
    sessionCookie: 'sess',
    releaseTypes: REDACTED_RELEASE_TYPES,
    rateLimits: REDACTED_RATE_LIMITS,
    timeoutMs: 5000,
    ...overrides
  })
}

function okIndex(): { status: number; text: string } {
  return {
    status: 200,
    text: JSON.stringify({
      status: 'success',
      response: { authkey: 'ak', passkey: 'pk' }
    })
  }
}

describe('authHeaders', () => {
  it('prefers API key when requested', () => {
    expect(
      authHeaders({
        apiKey: 'key',
        sessionCookie: 'cookie',
        preferApiKey: true,
        userAgent: 'test-client/1.0'
      })
    ).toMatchObject({ Authorization: 'key' })
  })

  it('uses session cookie when API key not preferred or missing', () => {
    expect(
      authHeaders({
        apiKey: '',
        sessionCookie: 'cookie',
        preferApiKey: true,
        userAgent: 'test-client/1.0'
      }).Cookie
    ).toBe('session=cookie')
    expect(
      authHeaders({
        apiKey: 'key',
        sessionCookie: 'cookie',
        preferApiKey: false,
        userAgent: 'test-client/1.0'
      }).Cookie
    ).toBe('session=cookie')
  })
})

describe('GazelleClient', () => {
  it('rejects HTTP tracker URLs before sending credentials', () => {
    expect(() => client({ siteUrl: 'http://example.test' })).toThrow(
      'Tracker site URL must use HTTPS'
    )
  })
})

describe('parseTorrentGroupIdFromUrl', () => {
  it('extracts id query param', () => {
    expect(parseTorrentGroupIdFromUrl('https://example.test/torrents.php?id=42&foo=1')).toBe(42)
    expect(parseTorrentGroupIdFromUrl('https://example.test/torrents.php?torrentid=9')).toBeNull()
  })
})

describe('GazelleClient', () => {
  it('authenticates via index and strips trailing slashes from URLs', async () => {
    const calls: Array<{ url: string; headers: Headers | Record<string, string> | undefined }> = []
    stubFetch(async (input, init) => {
      calls.push({ url: input, headers: init?.headers as Headers })
      return {
        status: 200,
        text: JSON.stringify({
          status: 'success',
          response: { authkey: 'ak', passkey: 'pk' }
        })
      }
    })

    const c = client({ apiKey: 'api-key', sessionCookie: '' })
    const info = await c.authenticate()
    expect(info.passkey).toBe('pk')
    expect(c.siteUrl).toBe('https://example.test')
    expect(c.announceUrl).toBe('https://announce.example.test')
    expect(c.announce).toBe('https://announce.example.test/pk/announce')
    expect(calls[0]?.url).toContain('https://example.test/ajax.php')
    expect(calls[0]?.url).toContain('action=index')
    const headers = new Headers(calls[0]?.headers)
    expect(headers.get('Authorization')).toBe('api-key')
    expect(headers.get('User-Agent')).toBe(DEFAULT_USER_AGENT)
  })

  it('throws TrackerRequestError on failed envelope', async () => {
    stubFetch(async () => ({
      status: 200,
      text: JSON.stringify({ status: 'failure', error: 'bad search' })
    }))
    const c = client({ apiKey: 'k' })
    await expect(c.browse({ searchstr: 'x' })).rejects.toBeInstanceOf(TrackerRequestError)
  })

  it('throws TrackerLoginError on 401', async () => {
    stubFetch(async () => ({
      status: 401,
      text: JSON.stringify({ error: 'invalid key' })
    }))
    const c = client({ apiKey: 'bad' })
    await expect(c.authenticate()).rejects.toBeInstanceOf(TrackerLoginError)
  })

  it('resolves torrent group id from redirected URL', async () => {
    stubFetch(async (input) => {
      if (input.includes('action=index')) {
        return {
          status: 200,
          text: JSON.stringify({
            status: 'success',
            response: { authkey: 'ak', passkey: 'pk' }
          })
        }
      }
      return {
        status: 200,
        url: 'https://example.test/torrents.php?id=99',
        text: '<html></html>'
      }
    })
    const c = client()
    await expect(c.torrentGroupIdFromTorrentId(7)).resolves.toBe(99)
  })

  it('uses cookie auth for non-ajax page requests', async () => {
    const calls: Array<{ url: string; auth?: string | null; cookie?: string | null }> = []
    stubFetch(async (input, init) => {
      const headers = new Headers(init?.headers)
      calls.push({
        url: input,
        auth: headers.get('Authorization'),
        cookie: headers.get('Cookie')
      })
      if (input.includes('action=index')) {
        return {
          status: 200,
          text: JSON.stringify({
            status: 'success',
            response: { authkey: 'ak', passkey: 'pk' }
          })
        }
      }
      return {
        status: 200,
        url: 'https://example.test/torrents.php?id=1',
        text: 'ok'
      }
    })

    const c = client({ apiKey: 'key', sessionCookie: 'sess' })
    await c.torrentGroupIdFromTorrentId(1)
    const pageCall = calls.find((c) => c.url.includes('torrents.php?torrentid='))
    expect(pageCall?.auth).toBeNull()
    expect(pageCall?.cookie).toBe('session=sess')
  })

  it('checks log via pastelog POST', async () => {
    const calls: Array<{ url: string; method?: string; body?: FormData }> = []
    stubFetch(async (input, init) => {
      calls.push({ url: input, method: init?.method, body: init?.body as FormData | undefined })
      if (input.includes('action=index')) {
        return {
          status: 200,
          text: JSON.stringify({
            status: 'success',
            response: { authkey: 'ak', passkey: 'pk' }
          })
        }
      }
      return {
        status: 200,
        text: JSON.stringify({
          status: 'success',
          response: {
            score: 59,
            issues: ['Test and copy was not used (-20 points)'],
            ripper: 'EAC',
            checksum: 'checksum_invalid'
          }
        })
      }
    })

    const c = client({ apiKey: 'key' })
    const result = await c.checkLog({ pastelog: 'Exact Audio Copy V1.0' })
    expect(result.score).toBe(59)
    expect(result.issues).toEqual(['Test and copy was not used (-20 points)'])
    expect(result.ripper).toBe('EAC')
    expect(result.checksum).toBe('checksum_invalid')

    const logCall = calls.find((call) => String(call.url).includes('action=logchecker'))
    expect(logCall?.method).toBe('POST')
    expect(logCall?.body).toBeInstanceOf(FormData)
    expect(logCall?.body?.get('pastelog')).toBe('Exact Audio Copy V1.0')
  })

  it('prefers uploaded log file over pastelog', async () => {
    let body: FormData | undefined
    stubFetch(async (input, init) => {
      if (input.includes('action=index')) {
        return {
          status: 200,
          text: JSON.stringify({
            status: 'success',
            response: { authkey: 'ak', passkey: 'pk' }
          })
        }
      }
      body = init?.body as FormData | undefined
      return {
        status: 200,
        text: JSON.stringify({
          status: 'success',
          response: { score: 100, issues: [] }
        })
      }
    })

    const c = client({ apiKey: 'key' })
    await c.checkLog({
      pastelog: 'ignored',
      log: { data: new TextEncoder().encode('log contents'), filename: 'disc.log' }
    })
    expect(body?.get('pastelog')).toBeNull()
    const file = body?.get('log')
    expect(file).toBeTruthy()
    expect(typeof file === 'object' && file !== null && 'name' in file && file.name).toBe('disc.log')
  })

  it('rejects checkLog without pastelog or file', async () => {
    const c = client({ apiKey: 'key' })
    await expect(c.checkLog({ pastelog: '' })).rejects.toBeInstanceOf(TrackerRequestError)
  })
})

describe('release types', () => {
  it('Orpheus includes Split and Demo with OPS ids', () => {
    expect(ORPHEUS_RELEASE_TYPES.Split).toBe(12)
    expect(ORPHEUS_RELEASE_TYPES.Demo).toBe(10)
    expect(REDACTED_RELEASE_TYPES.Demo).toBe(17)
    expect(REDACTED_RELEASE_TYPES.Split).toBeUndefined()
  })
})

describe('rate limits', () => {
  it('uses RED and OPS documented burst windows', () => {
    expect(REDACTED_RATE_LIMITS.session).toEqual({ maxRequests: 5, windowMs: 10_000 })
    expect(REDACTED_RATE_LIMITS.apiKey).toEqual({ maxRequests: 10, windowMs: 10_000 })
    expect(ORPHEUS_RATE_LIMITS.session).toEqual({ maxRequests: 5, windowMs: 10_000 })
    expect(ORPHEUS_RATE_LIMITS.apiKey).toEqual({ maxRequests: 5, windowMs: 10_000 })
    expect(usesApiKeyAuth('key', true)).toBe(true)
    expect(usesApiKeyAuth('key', false)).toBe(false)
  })

  it('RateLimiter blocks once the burst window is full', async () => {
    const limiter = new RateLimiter(2, 50)
    await limiter.acquire()
    await limiter.acquire()
    expect(limiter.pendingCount).toBe(2)
    const started = Date.now()
    await limiter.acquire()
    expect(Date.now() - started).toBeGreaterThanOrEqual(40)
  })

  it('honors Retry-After on HTTP 429 before retrying', async () => {
    let calls = 0
    stubFetch(async (input) => {
      if (input.includes('action=index')) return okIndex()
      calls += 1
      if (calls === 1) {
        return {
          status: 429,
          text: 'rate limit',
          headers: { 'Retry-After': '0' }
        }
      }
      return {
        status: 200,
        text: JSON.stringify({
          status: 'success',
          response: { results: [] }
        })
      }
    })

    const c = client({ apiKey: 'key' })
    await expect(c.browse({ searchstr: 'x' })).resolves.toEqual({ results: [] })
    expect(calls).toBe(2)
  })
})
