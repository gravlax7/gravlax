import type { TorrentClientConfig } from '@shared/types/config'

export interface QBittorrentAddOptions {
  /**
   * Explicit location for the data, with Automatic Torrent Management turned
   * off so qBittorrent honours it. Null delegates to ATM, which derives the
   * location from the category instead.
   */
  savePath: string | null
  category?: string
  paused?: boolean
  filename?: string
}

export interface QBittorrentTorrent {
  hash: string
  name: string
  /** qBittorrent's own state string, e.g. `uploading`, `stalledUP`, `pausedUP`. */
  state: string
  savePath: string
  category: string
}

export class QBittorrentClient {
  private readonly baseUrl: string
  private readonly username: string
  private readonly password: string
  private cookie = ''

  constructor(cfg: Pick<TorrentClientConfig, 'url' | 'username' | 'password'>) {
    this.baseUrl = normalizeBaseUrl(cfg.url)
    this.username = cfg.username
    this.password = cfg.password
  }

  async login(): Promise<void> {
    const body = new URLSearchParams()
    body.set('username', this.username)
    body.set('password', this.password)
    const res = await fetch(`${this.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`qBittorrent login failed (${res.status})`)
    }
    if (text.trim() === 'Fails.') {
      throw new Error('qBittorrent login failed: incorrect credentials')
    }
    const cookie = extractSidCookie(res.headers)
    if (!cookie) {
      throw new Error('qBittorrent login failed: no session cookie')
    }
    this.cookie = cookie
  }

  async version(): Promise<string> {
    const res = await this.request('/api/v2/app/version')
    if (!res.ok) {
      throw new Error(`qBittorrent version check failed (${res.status})`)
    }
    return (await res.text()).trim()
  }

  async addTorrent(data: Uint8Array, options: QBittorrentAddOptions): Promise<void> {
    const form = new FormData()
    const blob = new Blob([Buffer.from(data)], { type: 'application/x-bittorrent' })
    form.append('torrents', blob, options.filename ?? 'upload.torrent')
    if (options.savePath === null) {
      // ATM derives the location from the category; savepath must be left
      // off entirely, since qBittorrent would ignore it anyway.
      form.append('autoTMM', 'true')
    } else if (options.savePath !== '') {
      form.append('savepath', options.savePath)
      // Without this, ATM silently overrides savepath with the category's
      // configured path and the client looks for the data in the wrong place.
      form.append('autoTMM', 'false')
    }
    if (options.category) form.append('category', options.category)
    if (options.paused !== undefined) {
      const value = options.paused ? 'true' : 'false'
      // `paused` is the 4.x spelling, `stopped` the 5.x one. Unknown form
      // fields are ignored, so sending both covers either server.
      form.append('paused', value)
      form.append('stopped', value)
    }

    const encoded = await encodeMultipartForm(form)
    const res = await this.request('/api/v2/torrents/add', {
      method: 'POST',
      headers: { 'Content-Type': encoded.contentType },
      body: encoded.body
    })
    const text = (await res.text()).trim()
    if (!res.ok) {
      throw new Error(`qBittorrent add torrent failed (${res.status}): ${text || 'unknown error'}`)
    }
    if (text && text !== 'Ok.' && text.toLowerCase() !== 'ok') {
      throw new Error(`qBittorrent add torrent failed: ${text}`)
    }
  }

  /**
   * The torrent the client holds for `infoHash`, or null when it holds none.
   *
   * `/torrents/add` answers "Ok." whether or not anything landed — a rejected
   * or silently-dropped torrent looks identical to a successful one — so this
   * is what turns "the POST returned 200" into "the client really took it".
   */
  async getTorrent(infoHash: string): Promise<QBittorrentTorrent | null> {
    const hash = infoHash.trim().toLowerCase()
    if (!hash) return null
    const res = await this.request(`/api/v2/torrents/info?hashes=${encodeURIComponent(hash)}`)
    if (!res.ok) {
      throw new Error(`qBittorrent torrent lookup failed (${res.status})`)
    }
    const body = (await res.json()) as unknown
    if (!Array.isArray(body) || body.length === 0) return null
    const entry = body[0] as Record<string, unknown>
    return {
      hash: typeof entry.hash === 'string' ? entry.hash : hash,
      name: typeof entry.name === 'string' ? entry.name : '',
      state: typeof entry.state === 'string' ? entry.state : '',
      savePath: typeof entry.save_path === 'string' ? entry.save_path : '',
      category: typeof entry.category === 'string' ? entry.category : ''
    }
  }

  /**
   * Issues an authenticated request, logging in first when there is no session
   * and retrying once if the server rejects the cookie (SIDs expire, and
   * qBittorrent drops them whenever its WebUI restarts).
   */
  private async request(path: string, init?: RequestInit): Promise<Response> {
    if (!this.cookie) await this.login()

    const send = (): Promise<Response> => {
      const headers = new Headers(init?.headers)
      if (this.cookie) headers.set('Cookie', this.cookie)
      return fetch(`${this.baseUrl}${path}`, { ...init, headers })
    }

    const res = await send()
    if (res.status !== 401 && res.status !== 403) return res

    this.cookie = ''
    await this.login()
    return send()
  }
}

export function createQBittorrentClient(cfg: TorrentClientConfig): QBittorrentClient {
  return new QBittorrentClient(cfg)
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

async function encodeMultipartForm(
  form: FormData
): Promise<{ body: Uint8Array<ArrayBuffer>; contentType: string }> {
  const encoded = new Response(form)
  const contentType = encoded.headers.get('Content-Type')
  if (!contentType) throw new Error('Could not encode qBittorrent multipart request')

  const bytes = new Uint8Array(await encoded.arrayBuffer())
  if (bytes.at(-2) === 13 && bytes.at(-1) === 10) return { body: bytes, contentType }

  // qBittorrent's multipart parser expects the closing boundary to end in
  // CRLF. Node's FormData encoder omits it, which leaves the boundary text in
  // the final field value and makes `stopped=true` fail boolean parsing.
  const body = new Uint8Array(bytes.byteLength + 2)
  body.set(bytes)
  body.set([13, 10], bytes.byteLength)
  return { body, contentType }
}

function extractSidCookie(headers: Headers): string | null {
  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie
  const lines =
    typeof getSetCookie === 'function'
      ? getSetCookie.call(headers)
      : (() => {
          const single = headers.get('set-cookie')
          return single ? [single] : []
        })()
  for (const line of lines) {
    const match = /(?:^|,\s*)SID=([^;,\s]+)/i.exec(line)
    if (match?.[1]) return `SID=${match[1]}`
  }
  return null
}
