import { afterEach, describe, expect, it, vi } from 'vitest'
import { QBittorrentClient } from '../qbittorrent'
import { resolveTorrentSavePath } from '../savePath'
import { defaultConfig } from '@main/core/config/defaults'
import type { TorrentClientConfig } from '@shared/types/config'

function clientConfig(overrides: Partial<TorrentClientConfig> = {}): TorrentClientConfig {
  return {
    ...defaultConfig().torrentClient,
    url: 'http://127.0.0.1:8080',
    username: 'admin',
    password: 'secret',
    ...overrides
  }
}

describe('QBittorrentClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('rejects non-loopback HTTP URLs before sending credentials', () => {
    expect(
      () =>
        new QBittorrentClient(clientConfig({
          url: 'http://192.168.1.20:8080',
          allowInsecureHTTP: false
        }))
    ).toThrow(
      'qBittorrent WebUI URL must use HTTPS, use HTTP on localhost, or allow HTTP on a private LAN'
    )
  })

  it('allows private LAN HTTP after opt-in', () => {
    expect(
      () =>
        new QBittorrentClient(clientConfig({
          url: 'http://192.168.1.20:8080',
          allowInsecureHTTP: true
        }))
    ).not.toThrow()
  })

  it('logs in and stores the legacy SID cookie', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v2/auth/login')) {
        expect(init?.method).toBe('POST')
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': 'SID=abc123; HttpOnly; Path=/' }
        })
      }
      if (url.endsWith('/api/v2/app/version')) {
        expect((init?.headers as Headers).get('Cookie')).toBe('SID=abc123')
        return new Response('v5.0.0', { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QBittorrentClient(
      clientConfig({ url: 'http://127.0.0.1:8080/', apiKey: 'qbt_unused' })
    )
    await expect(client.version()).resolves.toBe('v5.0.0')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('logs in and stores the port-scoped qBittorrent 5.2 session cookie', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v2/auth/login')) {
        return new Response(null, {
          status: 204,
          headers: { 'set-cookie': 'QBT_SID_8080=abc123; HttpOnly; Path=/' }
        })
      }
      if (url.endsWith('/api/v2/app/version')) {
        expect((init?.headers as Headers).get('Cookie')).toBe('QBT_SID_8080=abc123')
        return new Response('v5.2.0', { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QBittorrentClient(clientConfig())
    await expect(client.version()).resolves.toBe('v5.2.0')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('uses a trimmed API key without starting a cookie session', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8080/api/v2/app/version')
      const headers = init?.headers as Headers
      expect(headers.get('Authorization')).toBe('Bearer qbt_api_key')
      expect(headers.get('Cookie')).toBeNull()
      return new Response('v5.2.0', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QBittorrentClient(
      clientConfig({ useApiKey: true, apiKey: '  qbt_api_key  ' })
    )
    await expect(client.version()).resolves.toBe('v5.2.0')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects a missing API key before sending a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const client = new QBittorrentClient(clientConfig({ useApiKey: true, apiKey: '  ' }))
    await expect(client.version()).rejects.toThrow('qBittorrent API key is missing')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fall back to password login when an API key is rejected', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('http://127.0.0.1:8080/api/v2/app/version')
      expect((init?.headers as Headers).get('Authorization')).toBe('Bearer qbt_rejected')
      return new Response('Forbidden', { status: 403 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QBittorrentClient(
      clientConfig({ useApiKey: true, apiKey: 'qbt_rejected' })
    )
    await expect(client.version()).rejects.toThrow(
      'qBittorrent API key authentication failed (403)'
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('rejects failed login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Fails.', { status: 200 }))
    )
    const client = new QBittorrentClient(clientConfig({ password: 'wrong' }))
    await expect(client.login()).rejects.toThrow(/incorrect credentials/)
  })

  it('adds torrent with savepath category and paused', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v2/auth/login')) {
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': 'SID=xyz; Path=/' }
        })
      }
      if (url.endsWith('/api/v2/torrents/add')) {
        expect(init?.method).toBe('POST')
        const body = Buffer.from(init?.body as Uint8Array)
        expect(body.subarray(-2)).toEqual(Buffer.from('\r\n'))
        const form = await new Response(body, { headers: init?.headers }).formData()
        expect(form.get('savepath')).toBe('/downloads')
        expect(form.get('category')).toBe('music')
        expect(form.get('paused')).toBe('true')
        // 5.x spelling, sent alongside the 4.x `paused`
        expect(form.get('stopped')).toBe('true')
        // Without this, Automatic Torrent Management overrides savepath
        expect(form.get('autoTMM')).toBe('false')
        expect(form.get('torrents')).toBeInstanceOf(Blob)
        return new Response('Ok.', { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QBittorrentClient(clientConfig())
    await client.addTorrent(new Uint8Array([1, 2, 3]), {
      savePath: '/downloads',
      category: 'music',
      paused: true
    })
  })

  it('accepts the qBittorrent 5.2 JSON add response', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe('http://127.0.0.1:8080/api/v2/torrents/add')
      return new Response(
        JSON.stringify({
          success_count: 1,
          pending_count: 0,
          failure_count: 0,
          added_torrent_ids: ['9b180d4c452c5c90443e4be68ecb824f8fcf376e']
        }),
        { status: 200 }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QBittorrentClient(
      clientConfig({ useApiKey: true, apiKey: 'qbt_api_key' })
    )
    await expect(
      client.addTorrent(new Uint8Array([1, 2, 3]), { savePath: '/downloads' })
    ).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('accepts a pending qBittorrent 5.2 add response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success_count: 0,
            pending_count: 1,
            failure_count: 0,
            added_torrent_ids: []
          }),
          { status: 202 }
        )
      )
    )

    const client = new QBittorrentClient(
      clientConfig({ useApiKey: true, apiKey: 'qbt_api_key' })
    )
    await expect(
      client.addTorrent(new Uint8Array([1, 2, 3]), { savePath: '/downloads' })
    ).resolves.toBeUndefined()
  })

  it('rejects a JSON add response that accepted no torrents', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            success_count: 0,
            pending_count: 0,
            failure_count: 1,
            added_torrent_ids: []
          }),
          { status: 200 }
        )
      )
    )

    const client = new QBittorrentClient(
      clientConfig({ useApiKey: true, apiKey: 'qbt_api_key' })
    )
    await expect(
      client.addTorrent(new Uint8Array([1, 2, 3]), { savePath: '/downloads' })
    ).rejects.toThrow('qBittorrent add torrent failed')
  })

  it('delegates to ATM and omits savepath when savePath is null', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v2/auth/login')) {
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': 'SID=xyz; Path=/' }
        })
      }
      if (url.endsWith('/api/v2/torrents/add')) {
        const form = await new Response(init?.body, { headers: init?.headers }).formData()
        expect(form.get('autoTMM')).toBe('true')
        // Sending both is contradictory — qBittorrent would ignore savepath.
        expect(form.get('savepath')).toBeNull()
        expect(form.get('category')).toBe('music')
        return new Response('Ok.', { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QBittorrentClient(clientConfig())
    await client.addTorrent(new Uint8Array([1, 2, 3]), { savePath: null, category: 'music' })
  })

  it('re-authenticates once when the session cookie is rejected', async () => {
    let logins = 0
    let adds = 0
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/api/v2/auth/login')) {
        logins++
        return new Response('Ok.', {
          status: 200,
          headers: { 'set-cookie': `SID=session${logins}; Path=/` }
        })
      }
      if (url.endsWith('/api/v2/torrents/add')) {
        adds++
        // Stale cookie from a WebUI restart: reject the first attempt.
        if (adds === 1) {
          expect((init?.headers as Headers).get('Cookie')).toBe('SID=session1')
          return new Response('Forbidden', { status: 403 })
        }
        expect((init?.headers as Headers).get('Cookie')).toBe('SID=session2')
        // Encoded bytes can be sent again after re-authentication.
        const form = await new Response(init?.body, { headers: init?.headers }).formData()
        expect(form.get('torrents')).toBeInstanceOf(Blob)
        return new Response('Ok.', { status: 200 })
      }
      throw new Error(`unexpected url ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const client = new QBittorrentClient(clientConfig())
    await client.addTorrent(new Uint8Array([1, 2, 3]), { savePath: '/downloads' })
    expect(logins).toBe(2)
    expect(adds).toBe(2)
  })
})

describe('resolveTorrentSavePath', () => {
  it('uses the configured save path when seedbox is disabled', () => {
    const cfg = defaultConfig()
    cfg.torrentClient.savePath = '/local/seed'
    cfg.transfer.enabled = false
    expect(resolveTorrentSavePath(cfg)).toBe('/local/seed')
  })

  it('prefers the save path over remotePath when seedbox is enabled', () => {
    const cfg = defaultConfig()
    cfg.transfer.enabled = true
    cfg.transfer.remotePath = '/sftp/path'
    cfg.torrentClient.savePath = '/qbittorrent/path'
    expect(resolveTorrentSavePath(cfg)).toBe('/qbittorrent/path')
  })

  it('falls back to remotePath when the save path is empty', () => {
    const cfg = defaultConfig()
    cfg.transfer.enabled = true
    cfg.transfer.remotePath = '/sftp/path'
    cfg.torrentClient.savePath = ''
    expect(resolveTorrentSavePath(cfg)).toBe('/sftp/path')
  })

  it('reports an empty path when nothing is configured to fall back to', () => {
    const cfg = defaultConfig()
    cfg.transfer.enabled = false
    cfg.torrentClient.savePath = ''
    expect(resolveTorrentSavePath(cfg)).toBe('')
  })

  it('returns null under ATM, even with a save path configured', () => {
    const cfg = defaultConfig()
    cfg.torrentClient.useAutoTMM = true
    cfg.torrentClient.savePath = '/ignored'
    cfg.transfer.enabled = true
    cfg.transfer.remotePath = '/sftp/path'
    expect(resolveTorrentSavePath(cfg)).toBeNull()
  })
})
