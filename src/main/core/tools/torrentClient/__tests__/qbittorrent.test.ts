import { afterEach, describe, expect, it, vi } from 'vitest'
import { QBittorrentClient } from '../qbittorrent'
import { resolveTorrentSavePath } from '../savePath'
import { defaultConfig } from '@main/core/config/defaults'

describe('QBittorrentClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('logs in and stores SID cookie', async () => {
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

    const client = new QBittorrentClient({
      url: 'http://127.0.0.1:8080/',
      username: 'admin',
      password: 'secret'
    })
    await expect(client.version()).resolves.toBe('v5.0.0')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects failed login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('Fails.', { status: 200 }))
    )
    const client = new QBittorrentClient({
      url: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'wrong'
    })
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

    const client = new QBittorrentClient({
      url: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'secret'
    })
    await client.addTorrent(new Uint8Array([1, 2, 3]), {
      savePath: '/downloads',
      category: 'music',
      paused: true
    })
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

    const client = new QBittorrentClient({
      url: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'secret'
    })
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

    const client = new QBittorrentClient({
      url: 'http://127.0.0.1:8080',
      username: 'admin',
      password: 'secret'
    })
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
