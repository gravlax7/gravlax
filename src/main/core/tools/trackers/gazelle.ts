import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import { isHTTPSURL } from '@shared/config/network'
import {
  extractHtmlErrorMessage,
  extractSiteUploadError,
  parseMostRecentTorrentAndGroupIdFromGroupPage,
  parseTorrentIdFromFilledRequestPage,
  parseUploadFormPrefill
} from './html'
import type {
  BrowseParams,
  GazelleClientOptions,
  GazelleEnvelope,
  GazelleIndexResponse,
  LogcheckerInput,
  LogcheckerResult,
  TrackerRateLimits,
  TrackerUploadData,
  TrackerUploadFiles,
  TrackerUploadResult
} from './types'
import { asArray, asRecord, compileArtists, decodeHtml } from './json'

const MAX_ATTEMPTS = 5
const RETRY_WAIT_MS = 1000

export class TrackerLoginError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TrackerLoginError'
  }
}

export class TrackerRequestError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TrackerRequestError'
  }
}

class RetryableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RetryableError'
  }
}

interface HttpResult {
  text: string
  url: string
  status: number
  headers: Headers
}

export function normalizeTrackerUrl(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

export function parseTorrentGroupIdFromUrl(url: string): number | null {
  try {
    const parsed = new URL(url)
    const id = parsed.searchParams.get('id')
    if (!id) return null
    const n = Number(id)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}

export function usesApiKeyAuth(apiKey: string, preferApiKey: boolean): boolean {
  return preferApiKey && apiKey !== ''
}

export function authHeaders(options: {
  apiKey: string
  sessionCookie: string
  preferApiKey: boolean
  userAgent: string
}): Record<string, string> {
  const headers: Record<string, string> = {
    Connection: 'keep-alive',
    'Cache-Control': 'max-age=0',
    'User-Agent': options.userAgent
  }
  if (usesApiKeyAuth(options.apiKey, options.preferApiKey)) {
    headers.Authorization = options.apiKey
  } else if (options.sessionCookie !== '') {
    headers.Cookie = `session=${options.sessionCookie}`
  }
  return headers
}

export class RateLimiter {
  private timestamps: number[] = []

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number
  ) {}

  async acquire(): Promise<void> {
    for (;;) {
      const now = Date.now()
      this.timestamps = this.timestamps.filter((t) => now - t < this.windowMs)
      if (this.timestamps.length < this.maxRequests) {
        this.timestamps.push(now)
        return
      }
      const waitMs = this.windowMs - (now - this.timestamps[0]!) + 1
      await sleep(Math.max(1, waitMs))
    }
  }

  reset(): void {
    this.timestamps = []
  }

  get pendingCount(): number {
    const now = Date.now()
    return this.timestamps.filter((t) => now - t < this.windowMs).length
  }
}

interface SiteRateLimiters {
  session: RateLimiter
  apiKey: RateLimiter
}

const rateLimitersBySite = new Map<string, SiteRateLimiters>()

function rateLimitersForSite(siteUrl: string, rateLimits: TrackerRateLimits): SiteRateLimiters {
  const key = normalizeTrackerUrl(siteUrl)
  const existing = rateLimitersBySite.get(key)
  if (existing) return existing
  const created: SiteRateLimiters = {
    session: new RateLimiter(rateLimits.session.maxRequests, rateLimits.session.windowMs),
    apiKey: new RateLimiter(rateLimits.apiKey.maxRequests, rateLimits.apiKey.windowMs)
  }
  rateLimitersBySite.set(key, created)
  return created
}

export function resetTrackerRateLimiter(): void {
  for (const limiters of rateLimitersBySite.values()) {
    limiters.session.reset()
    limiters.apiKey.reset()
  }
  rateLimitersBySite.clear()
}

function assertHTTPSURL(url: string, label: string): void {
  if (url !== '' && !isHTTPSURL(url)) {
    throw new TrackerRequestError(`Tracker ${label} must use HTTPS`)
  }
}

export class GazelleClient {
  readonly siteUrl: string
  readonly announceUrl: string
  readonly releaseTypes: Record<string, number>
  private readonly apiKey: string
  private readonly sessionCookie: string
  private readonly timeoutMs: number
  private readonly userAgent: string
  private readonly rateLimiters: SiteRateLimiters
  private authkey: string | null = null
  private passkey: string | null = null
  private authenticated = false

  constructor(options: GazelleClientOptions) {
    this.siteUrl = normalizeTrackerUrl(options.siteUrl)
    this.announceUrl = normalizeTrackerUrl(options.announceUrl)
    assertHTTPSURL(this.siteUrl, 'site URL')
    assertHTTPSURL(this.announceUrl, 'announce URL')
    this.apiKey = options.apiKey
    this.sessionCookie = options.sessionCookie
    this.releaseTypes = options.releaseTypes
    this.timeoutMs = options.timeoutMs ?? 10_000
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT
    this.rateLimiters = rateLimitersForSite(this.siteUrl, options.rateLimits)
  }

  get announce(): string {
    if (!this.passkey) {
      throw new TrackerRequestError('not authenticated: passkey unavailable')
    }
    return `${this.announceUrl}/${this.passkey}/announce`
  }

  requestUrl(id: number): string {
    return `${this.siteUrl}/requests.php?action=view&id=${id}`
  }

  torrentUrl(torrentId: number): string {
    return `${this.siteUrl}/torrents.php?torrentid=${torrentId}`
  }

  async authenticate(signal?: AbortSignal): Promise<GazelleIndexResponse> {
    const acctinfo = await this.index(true, signal)
    this.authkey = acctinfo.authkey
    this.passkey = acctinfo.passkey
    this.authenticated = true
    return acctinfo
  }

  /** Check one authentication path without falling back to the other. */
  async checkAuthentication(mode: 'api' | 'session', signal?: AbortSignal): Promise<void> {
    if (mode === 'api' && !this.apiKey) throw new TrackerRequestError('Missing API key')
    if (mode === 'session' && !this.sessionCookie) {
      throw new TrackerRequestError('Missing session cookie')
    }
    await this.index(mode === 'api', signal)
  }

  async ensureAuthenticated(signal?: AbortSignal): Promise<void> {
    if (!this.authenticated) {
      await this.authenticate(signal)
    }
  }

  async apiCall<T = unknown>(
    action: string,
    params: BrowseParams = {},
    signal?: AbortSignal
  ): Promise<T> {
    const query: Record<string, string> = { action }
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === '') continue
      query[key] = String(value)
    }

    const resp = await this.request('GET', `${this.siteUrl}/ajax.php`, {
      query,
      preferApiKey: true,
      timeoutMs: Math.min(this.timeoutMs, 5000),
      signal,
      skipAuth: action === 'index'
    })

    return parseEnvelope<T>(resp.text)
  }

  private async index(
    preferApiKey: boolean,
    signal?: AbortSignal
  ): Promise<GazelleIndexResponse> {
    const resp = await this.request('GET', `${this.siteUrl}/ajax.php`, {
      query: { action: 'index' },
      preferApiKey,
      timeoutMs: Math.min(this.timeoutMs, 5000),
      signal,
      skipAuth: true
    })
    return parseEnvelope<GazelleIndexResponse>(resp.text)
  }

  async browse(params: BrowseParams, signal?: AbortSignal): Promise<unknown> {
    return this.apiCall('browse', params, signal)
  }

  async torrentGroup(groupId: number, signal?: AbortSignal): Promise<unknown> {
    return this.apiCall('torrentgroup', { id: groupId }, signal)
  }

  async torrent(torrentId: number, signal?: AbortSignal): Promise<unknown> {
    return this.apiCall('torrent', { id: torrentId }, signal)
  }

  async searchRequests(search: string, signal?: AbortSignal): Promise<unknown> {
    return this.apiCall('requests', { search }, signal)
  }

  async getRequest(id: number, signal?: AbortSignal): Promise<unknown> {
    return this.apiCall('request', { id }, signal)
  }

  async checkLog(input: LogcheckerInput, signal?: AbortSignal): Promise<LogcheckerResult> {
    const form = new FormData()
    if (input.log) {
      const filename = input.log.filename?.trim() || 'log.log'
      const blob =
        input.log.data instanceof Blob
          ? input.log.data
          : new Blob([input.log.data], { type: 'text/plain' })
      form.append('log', blob, filename)
    } else if (input.pastelog !== undefined && input.pastelog !== '') {
      form.append('pastelog', input.pastelog)
    } else {
      throw new TrackerRequestError('logchecker requires pastelog or log file')
    }

    const resp = await this.request('POST', `${this.siteUrl}/ajax.php`, {
      query: { action: 'logchecker' },
      body: form,
      preferApiKey: true,
      timeoutMs: this.timeoutMs,
      signal
    })

    const result = parseEnvelope<Record<string, unknown>>(resp.text)
    const issues = Array.isArray(result.issues)
      ? result.issues.map((issue) => String(issue))
      : []
    const score = Number(result.score)
    if (!Number.isFinite(score)) {
      throw new TrackerRequestError('logchecker response missing score')
    }

    return {
      score,
      issues,
      ripper: typeof result.ripper === 'string' ? result.ripper : undefined,
      ripperVersion: typeof result.ripperVersion === 'string' ? result.ripperVersion : undefined,
      language: typeof result.language === 'string' ? result.language : undefined,
      checksum: typeof result.checksum === 'string' ? result.checksum : undefined
    }
  }

  async torrentGroupIdFromTorrentId(torrentId: number, signal?: AbortSignal): Promise<number | null> {
    const resp = await this.request('GET', `${this.siteUrl}/torrents.php`, {
      query: { torrentid: String(torrentId) },
      preferApiKey: false,
      timeoutMs: Math.min(this.timeoutMs, 5000),
      signal
    })
    return parseTorrentGroupIdFromUrl(resp.url)
  }

  async upload(
    data: TrackerUploadData,
    files: TrackerUploadFiles,
    signal?: AbortSignal
  ): Promise<TrackerUploadResult> {
    if (this.apiKey) {
      return this.apiKeyUpload(data, files, signal)
    }
    return this.sitePageUpload(data, files, signal)
  }

  async apiKeyUpload(
    data: TrackerUploadData,
    files: TrackerUploadFiles,
    signal?: AbortSignal
  ): Promise<TrackerUploadResult> {
    await this.ensureAuthenticated(signal)
    const payload = cloneUploadData(data)
    payload.auth = this.authkey ?? ''

    const resp = await this.request('POST', `${this.siteUrl}/ajax.php`, {
      query: { action: 'upload' },
      body: composeUploadFormData(files, payload),
      preferApiKey: true,
      timeoutMs: Math.max(this.timeoutMs, 30_000),
      signal
    })

    let envelope: GazelleEnvelope<Record<string, unknown>>
    try {
      envelope = JSON.parse(resp.text) as GazelleEnvelope<Record<string, unknown>>
    } catch {
      throw new TrackerRequestError(resp.text || 'invalid JSON response')
    }
    if (envelope.status !== 'success') {
      throw new TrackerRequestError(String(envelope.error ?? resp.text))
    }

    const body = envelope.response ?? {}
    const requestId =
      (typeof body.requestid === 'number' ? body.requestid : undefined) ??
      (asRecord(body.fillRequest).requestId as number | undefined)
    let filledRequestUrl: string | undefined
    if (typeof requestId === 'number') {
      if (requestId === -1) {
        throw new TrackerRequestError('Request fill failed')
      }
      filledRequestUrl = this.requestUrl(requestId)
    }

    const torrentId =
      (typeof body.torrentid === 'number' ? body.torrentid : undefined) ??
      (typeof body.torrentId === 'number' ? body.torrentId : undefined) ??
      0
    const groupId =
      (typeof body.groupid === 'number' ? body.groupid : undefined) ??
      (typeof body.groupId === 'number' ? body.groupId : undefined) ??
      0

    if (!torrentId || !groupId) {
      throw new TrackerRequestError(`API upload failed, response: ${resp.text}`)
    }

    return { torrentId, groupId, filledRequestUrl }
  }

  async sitePageUpload(
    data: TrackerUploadData,
    files: TrackerUploadFiles,
    signal?: AbortSignal
  ): Promise<TrackerUploadResult> {
    if (!this.sessionCookie) {
      throw new TrackerRequestError('session cookie required for site page upload')
    }
    await this.ensureAuthenticated(signal)
    const payload = cloneUploadData(data)
    payload.auth = this.authkey ?? ''

    const groupIdValue = payload.groupid
    const groupId =
      typeof groupIdValue === 'number'
        ? groupIdValue
        : typeof groupIdValue === 'string'
          ? Number(groupIdValue)
          : undefined
    const url =
      groupId !== undefined && Number.isFinite(groupId)
        ? `${this.siteUrl}/upload.php?groupid=${groupId}`
        : `${this.siteUrl}/upload.php`

    const resp = await this.request('POST', url, {
      body: composeUploadFormData(files, payload),
      preferApiKey: false,
      timeoutMs: Math.max(this.timeoutMs, 30_000),
      signal
    })

    if (this.announce && resp.text.includes(this.announce)) {
      const error = extractSiteUploadError(resp.text)
      if (error) {
        throw new TrackerRequestError(`Site upload failed: ${error} (${resp.status})`)
      }
    }

    if (resp.url.includes('requests.php')) {
      try {
        const torrentId = this.parseTorrentIdFromFilledRequestPage(resp.text)
        const resolvedGroupId = (await this.torrentGroupIdFromTorrentId(torrentId, signal)) ?? 0
        return { torrentId, groupId: resolvedGroupId, filledRequestUrl: resp.url }
      } catch (err) {
        const message = extractHtmlErrorMessage(resp.text) ?? resp.text
        throw new TrackerRequestError(
          `Request fill failed: ${message}`,
          { cause: err instanceof Error ? err : undefined }
        )
      }
    }

    try {
      return this.parseMostRecentTorrentAndGroupIdFromGroupPage(resp.text)
    } catch (err) {
      throw new TrackerRequestError(
        `Site upload failed, response text: ${resp.text}`,
        { cause: err instanceof Error ? err : undefined }
      )
    }
  }

  parseMostRecentTorrentAndGroupIdFromGroupPage(text: string): TrackerUploadResult {
    return parseMostRecentTorrentAndGroupIdFromGroupPage(text)
  }

  parseTorrentIdFromFilledRequestPage(text: string): number {
    return parseTorrentIdFromFilledRequestPage(text)
  }

  async enrichUploadDataFromGroup(
    data: TrackerUploadData,
    groupId: number,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.sessionCookie) {
      throw new TrackerRequestError('session cookie required to scrape upload form')
    }
    const resp = await this.request('GET', `${this.siteUrl}/upload.php`, {
      query: { groupid: String(groupId) },
      preferApiKey: false,
      timeoutMs: Math.max(this.timeoutMs, 10_000),
      signal
    })
    const prefill = parseUploadFormPrefill(resp.text)
    Object.assign(data, prefill)
  }

  lossyReportType(source: string): string {
    return source === 'WEB' ? 'lossywebapproval' : 'lossyapproval'
  }

  async reportLossyMaster(
    torrentId: number,
    comment: string,
    source: string,
    signal?: AbortSignal
  ): Promise<void> {
    if (!this.sessionCookie) {
      throw new TrackerRequestError('session cookie required for lossy master reports')
    }
    await this.ensureAuthenticated(signal)

    const body = new URLSearchParams()
    body.set('auth', this.authkey ?? '')
    body.set('torrentid', String(torrentId))
    body.set('categoryid', '1')
    body.set('type', this.lossyReportType(source))
    body.set('extra', comment)
    body.set('submit', 'True')

    const resp = await this.request('POST', `${this.siteUrl}/reportsv2.php`, {
      query: { action: 'takereport' },
      body,
      preferApiKey: false,
      timeoutMs: this.timeoutMs,
      signal
    })

    if (!resp.url.includes('torrents.php')) {
      throw new TrackerRequestError(
        `Failed to report torrent for lossy master: unexpected redirect to ${resp.url} (status ${resp.status})`
      )
    }
  }

  protected async request(
    method: string,
    url: string,
    options: {
      query?: Record<string, string>
      body?: FormData | URLSearchParams
      preferApiKey: boolean
      timeoutMs: number
      signal?: AbortSignal
      skipAuth?: boolean
    }
  ): Promise<HttpResult> {
    if (!options.skipAuth) {
      await this.ensureAuthenticated(options.signal)
    }

    let lastError: Error | undefined
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      try {
        return await this.requestOnce(method, url, options)
      } catch (err) {
        if (!(err instanceof RetryableError)) throw err
        lastError = err
        await sleep(RETRY_WAIT_MS)
      }
    }
    throw lastError ?? new TrackerRequestError('request failed after retries')
  }

  protected async requestOnce(
    method: string,
    url: string,
    options: {
      query?: Record<string, string>
      body?: FormData | URLSearchParams
      preferApiKey: boolean
      timeoutMs: number
      signal?: AbortSignal
    }
  ): Promise<HttpResult> {
    await (usesApiKeyAuth(this.apiKey, options.preferApiKey)
      ? this.rateLimiters.apiKey
      : this.rateLimiters.session
    ).acquire()

    const parsed = new URL(url)
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value) parsed.searchParams.set(key, value)
    }

    const headers = authHeaders({
      apiKey: this.apiKey,
      sessionCookie: this.sessionCookie,
      preferApiKey: options.preferApiKey,
      userAgent: this.userAgent
    })

    const timeout =
      options.timeoutMs > 0 ? AbortSignal.timeout(options.timeoutMs) : undefined
    const signals = [options.signal, timeout].filter(Boolean) as AbortSignal[]
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]

    let response: Response
    try {
      response = await fetch(parsed.toString(), {
        method,
        headers,
        body: options.body,
        signal,
        redirect: 'follow'
      })
    } catch (err) {
      throw new RetryableError(err instanceof Error ? err.message : String(err))
    }

    const text = await response.text()

    if (response.status === 401) {
      throw new TrackerLoginError(extractErrorMessage(text) || 'authentication failed')
    }

    if (response.status === 429 || /rate limit/i.test(text)) {
      const retryAfterHeader = response.headers.get('Retry-After')
      const retryAfter = Number(retryAfterHeader ?? '1')
      const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 1
      await sleep(waitSeconds * 1000)
      throw new RetryableError('rate limit exceeded')
    }

    if ([500, 502, 503, 504].includes(response.status)) {
      throw new RetryableError(`server error ${response.status}`)
    }

    if (response.status < 200 || response.status >= 300) {
      throw new TrackerRequestError(
        extractErrorMessage(text) || `request failed with status ${response.status}`
      )
    }

    return {
      text,
      url: response.url,
      status: response.status,
      headers: response.headers
    }
  }
}

function parseEnvelope<T>(text: string): T {
  let envelope: GazelleEnvelope<T>
  try {
    envelope = JSON.parse(text) as GazelleEnvelope<T>
  } catch {
    throw new TrackerRequestError(text || 'invalid JSON response')
  }
  if (envelope.status !== 'success') {
    throw new TrackerRequestError(String(envelope.error ?? text))
  }
  return envelope.response as T
}

function extractErrorMessage(text: string): string {
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (parsed.error !== undefined) return String(parsed.error)
  } catch {
    /* ignore */
  }
  return text.trim()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cloneUploadData(data: TrackerUploadData): TrackerUploadData {
  const out: TrackerUploadData = {}
  for (const [key, value] of Object.entries(data)) {
    out[key] = Array.isArray(value) ? [...value] : value
  }
  return out
}

export function composeUploadFormData(files: TrackerUploadFiles, data: TrackerUploadData): FormData {
  const form = new FormData()
  const torrentBlob =
    files.torrentData instanceof Blob
      ? files.torrentData
      : new Blob([files.torrentData], { type: 'application/octet-stream' })
  form.append('file_input', torrentBlob, 'meowmeow.torrent')

  for (const log of files.logFiles ?? []) {
    const logBlob =
      log.data instanceof Blob ? log.data : new Blob([log.data], { type: 'application/octet-stream' })
    form.append('logfiles[]', logBlob, log.filename)
  }

  for (const [key, value] of Object.entries(data)) {
    if (Array.isArray(value)) {
      for (const item of value) addFormField(form, key, item)
    } else {
      addFormField(form, key, value)
    }
  }
  return form
}

function addFormField(form: FormData, key: string, value: string | number | boolean): void {
  if (value === true) {
    form.append(key, 'on')
    return
  }
  if (value === false || value === null || value === undefined) return
  form.append(key, String(value))
}
