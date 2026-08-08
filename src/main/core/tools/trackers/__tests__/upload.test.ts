import { afterEach, describe, expect, it, vi } from 'vitest'
import { GazelleClient, TrackerRequestError, resetTrackerRateLimiter } from '../gazelle'
import { ORPHEUS_RATE_LIMITS, ORPHEUS_RELEASE_TYPES, OrpheusClient } from '../orpheus'
import { REDACTED_RATE_LIMITS, REDACTED_RELEASE_TYPES, RedactedClient } from '../redacted'
import type { TrackerUploadFiles } from '../types'

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

function okIndex(): { status: number; text: string } {
  return {
    status: 200,
    text: JSON.stringify({
      status: 'success',
      response: { authkey: 'ak', passkey: 'pk' }
    })
  }
}

const files: TrackerUploadFiles = {
  torrentData: new Uint8Array([1, 2, 3]),
  logFiles: []
}

const filesWithLog: TrackerUploadFiles = {
  torrentData: new Uint8Array([1, 2, 3]),
  logFiles: [{ filename: 'disc.log', data: new Uint8Array([9]) }]
}

describe('tracker upload paths', () => {
  it('uses API upload when api key is present', async () => {
    const calls: Array<{ url: string; auth?: string | null; cookie?: string | null }> = []
    stubFetch(async (input, init) => {
      const headers = new Headers(init?.headers)
      calls.push({
        url: input,
        auth: headers.get('Authorization'),
        cookie: headers.get('Cookie')
      })
      if (input.includes('action=index')) return okIndex()
      return {
        status: 200,
        text: JSON.stringify({
          status: 'success',
          response: { torrentid: 11, groupid: 22 }
        })
      }
    })

    const client = new GazelleClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: 'key',
      sessionCookie: 'sess',
      releaseTypes: REDACTED_RELEASE_TYPES,
      rateLimits: REDACTED_RATE_LIMITS
    })
    await expect(client.upload({ title: 'Album' }, files)).resolves.toEqual({
      torrentId: 11,
      groupId: 22,
      filledRequestUrl: undefined
    })
    const uploadCall = calls.find((c) => c.url.includes('action=upload'))
    expect(uploadCall?.auth).toBe('key')
    expect(uploadCall?.cookie).toBeNull()
  })

  it('uses site page upload when api key is missing', async () => {
    const calls: Array<{ url: string; auth?: string | null; cookie?: string | null }> = []
    stubFetch(async (input, init) => {
      const headers = new Headers(init?.headers)
      calls.push({
        url: input,
        auth: headers.get('Authorization'),
        cookie: headers.get('Cookie')
      })
      if (input.includes('action=index')) return okIndex()
      return {
        status: 200,
        url: 'https://example.test/torrents.php?id=9',
        text: `
          <a class="tooltip" href="torrents.php?torrentid=33">t</a>
          <a class="brackets" href="upload.php?groupid=9">[Add format]</a>
        `
      }
    })

    const client = new GazelleClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: '',
      sessionCookie: 'sess',
      releaseTypes: REDACTED_RELEASE_TYPES,
      rateLimits: REDACTED_RATE_LIMITS
    })
    await expect(client.upload({ title: 'Album' }, files)).resolves.toEqual({
      torrentId: 33,
      groupId: 9
    })
    const uploadCall = calls.find((c) => c.url.includes('/upload.php'))
    expect(uploadCall?.auth).toBeNull()
    expect(uploadCall?.cookie).toBe('session=sess')
  })

  it('forces RED site page upload when log files are present even with api key', async () => {
    const calls: string[] = []
    stubFetch(async (input) => {
      calls.push(input)
      if (input.includes('action=index')) return okIndex()
      return {
        status: 200,
        url: 'https://example.test/torrents.php?id=1',
        text: `
          <a class="tooltip" href="torrents.php?torrentid=7">t</a>
          <a class="brackets" href="upload.php?groupid=1">[Add format]</a>
        `
      }
    })

    const client = new RedactedClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: 'key',
      sessionCookie: 'sess',
      releaseTypes: REDACTED_RELEASE_TYPES,
      rateLimits: REDACTED_RATE_LIMITS
    })
    await expect(client.upload({ title: 'CD' }, filesWithLog)).resolves.toEqual({
      torrentId: 7,
      groupId: 1
    })
    expect(calls.some((url) => url.includes('action=upload'))).toBe(false)
    expect(calls.some((url) => url.includes('/upload.php'))).toBe(true)
  })

  it('OPS keeps API upload when log files are present', async () => {
    const calls: string[] = []
    stubFetch(async (input) => {
      calls.push(input)
      if (input.includes('action=index')) return okIndex()
      return {
        status: 200,
        text: JSON.stringify({
          status: 'success',
          response: { torrentId: 4, groupId: 5 }
        })
      }
    })

    const client = new OrpheusClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: 'key',
      sessionCookie: 'sess',
      releaseTypes: ORPHEUS_RELEASE_TYPES,
      rateLimits: ORPHEUS_RATE_LIMITS
    })
    await expect(client.upload({ title: 'CD' }, filesWithLog)).resolves.toEqual({
      torrentId: 4,
      groupId: 5,
      filledRequestUrl: undefined
    })
    expect(calls.some((url) => url.includes('action=upload'))).toBe(true)
    expect(calls.some((url) => url.includes('/upload.php'))).toBe(false)
  })

  it('RED enriches site page upload from upload.php form when groupid is set', async () => {
    const posted = { body: undefined as FormData | undefined }
    stubFetch(async (input, init) => {
      if (input.includes('action=index')) return okIndex()
      if (input.includes('/upload.php?groupid=12') && (!init?.method || init.method === 'GET')) {
        return {
          status: 200,
          text: `
            <input name="artists[]" value="Prefill Artist" />
            <select name="importance[]"><option value="1" selected>Main</option></select>
            <input name="title" value="Prefill Title" />
            <textarea name="album_desc">Prefill Desc</textarea>
          `
        }
      }
      if (init?.method === 'POST' && input.includes('/upload.php')) {
        posted.body = init.body as FormData
        return {
          status: 200,
          url: 'https://example.test/torrents.php?id=12',
          text: `
            <a class="tooltip" href="torrents.php?torrentid=100">t</a>
            <a class="brackets" href="upload.php?groupid=12">[Add format]</a>
          `
        }
      }
      throw new Error(`unexpected request ${input}`)
    })

    const client = new RedactedClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: '',
      sessionCookie: 'sess',
      releaseTypes: REDACTED_RELEASE_TYPES,
      rateLimits: REDACTED_RATE_LIMITS
    })
    await client.upload({ groupid: 12, media: 'CD' }, files)
    expect(posted.body?.get('title')).toBe('Prefill Title')
    expect(posted.body?.get('album_desc')).toBe('Prefill Desc')
    expect(posted.body?.getAll('artists[]')).toEqual(['Prefill Artist'])
  })

  it('OPS site page success parser uses permalink hrefs', async () => {
    stubFetch(async (input) => {
      if (input.includes('action=index')) return okIndex()
      return {
        status: 200,
        url: 'https://example.test/torrents.php?id=8',
        text: `<a title="Permalink" href="torrents.php?id=8&torrentid=55">PL</a>`
      }
    })

    const client = new OrpheusClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: '',
      sessionCookie: 'sess',
      releaseTypes: ORPHEUS_RELEASE_TYPES,
      rateLimits: ORPHEUS_RATE_LIMITS
    })
    await expect(client.upload({ title: 'Album' }, files)).resolves.toEqual({
      torrentId: 55,
      groupId: 8
    })
  })

  it('requires session cookie for site page upload', async () => {
    const client = new GazelleClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: '',
      sessionCookie: '',
      releaseTypes: REDACTED_RELEASE_TYPES,
      rateLimits: REDACTED_RATE_LIMITS
    })
    await expect(client.upload({ title: 'Album' }, files)).rejects.toBeInstanceOf(TrackerRequestError)
  })
})

describe('lossy master reports', () => {
  it('RED uses lossywebapproval for WEB and lossyapproval otherwise', async () => {
    const posts: Array<{ url: string; body: URLSearchParams; cookie: string | null }> = []
    stubFetch(async (input, init) => {
      if (input.includes('action=index')) return okIndex()
      posts.push({
        url: input,
        body: init?.body as URLSearchParams,
        cookie: new Headers(init?.headers).get('Cookie')
      })
      return {
        status: 200,
        url: 'https://example.test/torrents.php?torrentid=9',
        text: 'ok'
      }
    })

    const client = new RedactedClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: 'key',
      sessionCookie: 'sess',
      releaseTypes: REDACTED_RELEASE_TYPES,
      rateLimits: REDACTED_RATE_LIMITS
    })

    await client.reportLossyMaster(9, 'soft clipped', 'WEB')
    await client.reportLossyMaster(9, 'soft clipped', 'CD')

    expect(posts).toHaveLength(2)
    expect(posts[0]?.url).toContain('/reportsv2.php')
    expect(posts[0]?.url).toContain('action=takereport')
    expect(posts[0]?.cookie).toBe('session=sess')
    expect(posts[0]?.body.get('type')).toBe('lossywebapproval')
    expect(posts[0]?.body.get('extra')).toBe('soft clipped')
    expect(posts[0]?.body.get('torrentid')).toBe('9')
    expect(posts[1]?.body.get('type')).toBe('lossyapproval')
  })

  it('OPS always uses lossyapproval', async () => {
    let type: string | null = null
    stubFetch(async (input, init) => {
      if (input.includes('action=index')) return okIndex()
      type = (init?.body as URLSearchParams).get('type')
      return {
        status: 200,
        url: 'https://example.test/torrents.php?torrentid=3',
        text: 'ok'
      }
    })

    const client = new OrpheusClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: 'key',
      sessionCookie: 'sess',
      releaseTypes: ORPHEUS_RELEASE_TYPES,
      rateLimits: ORPHEUS_RATE_LIMITS
    })

    await client.reportLossyMaster(3, 'comment', 'WEB')
    expect(type).toBe('lossyapproval')
  })

  it('rejects unexpected report redirects', async () => {
    stubFetch(async (input) => {
      if (input.includes('action=index')) return okIndex()
      return {
        status: 200,
        url: 'https://example.test/reportsv2.php?action=report',
        text: 'nope'
      }
    })

    const client = new RedactedClient({
      siteUrl: 'https://example.test',
      announceUrl: 'https://announce.example.test',
      apiKey: '',
      sessionCookie: 'sess',
      releaseTypes: REDACTED_RELEASE_TYPES,
      rateLimits: REDACTED_RATE_LIMITS
    })
    await expect(client.reportLossyMaster(1, 'x', 'WEB')).rejects.toBeInstanceOf(TrackerRequestError)
  })
})
