import { appendFile, chmod, mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

type DiagnosticValue = string | number | boolean | null
type DiagnosticFields = Record<string, DiagnosticValue | undefined>

interface DiagnosticEntry extends Record<string, DiagnosticValue> {
  at: string
  event: string
}

const LOG_NAME = 'tracker-diagnostics.log'
const BACKUP_NAME = 'tracker-diagnostics.previous.log'
const MAX_LOG_BYTES = 512 * 1024
const MAX_REPORT_ENTRIES = 300

// These names must never reach disk, even if a future caller uses this helper
// without reading its contract first.
const FORBIDDEN_FIELD = /^(apiKey|authorization|body|cookie|headers?|requestBody|responseBody|responseText|sessionCookie|setCookie|url)$/i

let activeLog: DiagnosticLog | null = null

export function diagnosticError(error: unknown): DiagnosticFields {
  const chain = errorChain(error)
  const names = chain.flatMap((record) => typeof record.name === 'string' ? [record.name] : [])
  const messages = chain.flatMap((record) => typeof record.message === 'string' ? [record.message] : [])
  const errorName = names.find((name) => name !== 'RetryableError') ?? names[0] ?? 'Error'
  const causeName = names.find((name) => name !== errorName && name !== 'RetryableError')
  const errorCode = chain.map((record) => record.code ?? record.errno).map(asErrorCode).find(Boolean)
  const errorMessage = sanitizeDiagnosticMessage(
    messages.find((message) => !WRAPPER_ERROR_MESSAGE.test(message)) ?? messages[0]
  )
  const haystack = [...names, ...messages, errorCode ?? ''].join(' ').toLowerCase()

  let errorKind = 'request_failed'
  if (/rate limit|429/.test(haystack)) errorKind = 'rate_limit'
  else if (/timed?\s*out|timeout|abort/.test(haystack)) errorKind = 'timeout'
  else if (/login|auth|session|cookie|unauthor/.test(haystack) || names.includes('TrackerLoginError')) {
    errorKind = 'authentication'
  } else if (/security page|captcha|challenge/.test(haystack)) errorKind = 'security_page'
  else if (/json|html|response/.test(haystack)) errorKind = 'invalid_response'
  else if (/certificate|cert_|tls|ssl/.test(haystack)) errorKind = 'tls'
  else if (/dns|enotfound|eai_again|getaddrinfo/.test(haystack) || errorCode === 'ENOTFOUND') {
    errorKind = 'dns'
  } else if (/fetch|network|connect|socket/.test(haystack)) errorKind = 'network'

  return { errorKind, errorName, errorCode, causeName, errorMessage }
}

const WRAPPER_ERROR_MESSAGE = /^(network request failed|request failed after retries)$/i

function errorChain(error: unknown): Record<string, unknown>[] {
  const chain: Record<string, unknown>[] = []
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const record = current as Record<string, unknown>
    chain.push(record)
    current = record.cause
  }
  return chain
}

function asErrorCode(value: unknown): string | undefined {
  const code = typeof value === 'number' ? String(value) : value
  return typeof code === 'string' && /^[a-z0-9_-]{1,40}$/i.test(code) ? code : undefined
}

export function sanitizeDiagnosticMessage(value: string | undefined): string | undefined {
  if (!value) return undefined
  let text = value.trim()
  if (!text || /<[a-z!/?]/i.test(text)) return undefined
  text = text
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\b(?:[a-z0-9-]+\.)+[a-z]{2,}\b/gi, '[host]')
    .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[ip]')
    .replace(/(?:session|cookie|authorization|api[_-]?key)\s*[=:]\s*\S+/gi, '[redacted]')
    .replace(/\s+/g, ' ')
    .slice(0, 160)
  return text || undefined
}

export function jsonEnvelopeFields(kind: string, text: string): DiagnosticFields {
  if (kind !== 'json') return {}
  try {
    const parsed = JSON.parse(text.slice(0, 16_384)) as Record<string, unknown>
    const envelopeStatus = typeof parsed.status === 'string' ? parsed.status.slice(0, 40) : undefined
    const envelopeError = typeof parsed.error === 'string'
      ? sanitizeDiagnosticMessage(parsed.error)
      : undefined
    return { envelopeStatus, envelopeError }
  } catch {
    return {}
  }
}

export function responseKind(contentType: string, text: string): string {
  const sample = text.slice(0, 16_384).toLowerCase()
  if (contentType.toLowerCase().includes('json') || /^\s*[\[{]/.test(sample)) return 'json'
  if (/cloudflare|captcha|challenge-platform|checking your browser|access denied/.test(sample)) {
    return 'security-page'
  }
  if (
    /<form[^>]+(?:login|auth)|name=["'](?:username|password)["']|type=["']password["']/.test(sample)
  ) {
    return 'login-page'
  }
  if (/<(?:!doctype|html|head|body)\b/.test(sample)) return 'html'
  if (text === '') return 'empty'
  return 'text'
}

export function configureDiagnosticLog(options: {
  directory: string
  appVersion: string
  platform: NodeJS.Platform
  arch: string
}): void {
  activeLog = new DiagnosticLog(options.directory, {
    appVersion: options.appVersion,
    platform: options.platform,
    arch: options.arch
  })
  logDiagnostic('app_started', {
    appVersion: options.appVersion,
    platform: options.platform,
    arch: options.arch
  })
}

export function logDiagnostic(event: string, fields: DiagnosticFields = {}): void {
  activeLog?.write(event, fields)
}

export function sanitizeDiagnosticFields(fields: DiagnosticFields): Record<string, DiagnosticValue> {
  const safe: Record<string, DiagnosticValue> = {}
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || FORBIDDEN_FIELD.test(key)) continue
    safe[key] = typeof value === 'string' ? value.slice(0, 300) : value
  }
  return safe
}

export function trackerDiagnosticReport(): string {
  return activeLog?.report() ?? 'Tracker diagnostics are not ready.'
}

export async function diagnosticLogPath(): Promise<string> {
  if (!activeLog) throw new Error('Tracker diagnostics are not ready')
  return activeLog.readyPath()
}

class DiagnosticLog {
  private readonly path: string
  private readonly backupPath: string
  private readonly entries: DiagnosticEntry[] = []
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly directory: string,
    private readonly app: { appVersion: string; platform: NodeJS.Platform; arch: string }
  ) {
    this.path = join(directory, LOG_NAME)
    this.backupPath = join(directory, BACKUP_NAME)
  }

  write(event: string, fields: DiagnosticFields): void {
    const entry = this.entry(event, fields)
    this.entries.push(entry)
    if (this.entries.length > MAX_REPORT_ENTRIES) this.entries.shift()

    const line = `${formatEntry(entry)}\n`
    this.queue = this.queue
      .then(() => this.append(line))
      .catch((error) => {
        // This is the one place where stderr helps: the file logger itself failed.
        console.error('Could not write tracker diagnostics', diagnosticError(error))
      })
  }

  report(): string {
    const header = [
      'Gravlax tracker diagnostics',
      `App: ${this.app.appVersion}`,
      `System: ${this.app.platform} ${this.app.arch}`,
      ''
    ]
    return [...header, ...this.entries.map(formatEntry)].join('\n')
  }

  async readyPath(): Promise<string> {
    await this.queue
    await this.ensureDirectory()
    await appendFile(this.path, '', { encoding: 'utf8', mode: 0o600 })
    await chmod(this.path, 0o600)
    return this.path
  }

  private entry(event: string, fields: DiagnosticFields): DiagnosticEntry {
    return {
      at: new Date().toISOString(),
      event,
      ...sanitizeDiagnosticFields(fields)
    }
  }

  private async append(line: string): Promise<void> {
    await this.ensureDirectory()
    let size = 0
    try {
      size = (await stat(this.path)).size
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }

    if (size + Buffer.byteLength(line) > MAX_LOG_BYTES) {
      await rm(this.backupPath, { force: true })
      try {
        await rename(this.path, this.backupPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    }

    await appendFile(this.path, line, { encoding: 'utf8', mode: 0o600 })
    await chmod(this.path, 0o600)
  }

  private async ensureDirectory(): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
  }
}

function formatEntry(entry: DiagnosticEntry): string {
  const { at, event, ...fields } = entry
  const values = Object.entries(fields).map(([key, value]) => `${key}=${formatValue(value)}`)
  return [at, diagnosticCategory(event, fields), event, ...values].join(' ')
}

export function diagnosticCategory(
  event: string,
  fields: Record<string, DiagnosticValue>
): 'INFO' | 'WARN' | 'ERROR' {
  const status = typeof fields.status === 'number' ? fields.status : 0
  if (
    event === 'config_save_failed' ||
    fields.result === 'failing' ||
    fields.result === 'error' ||
    fields.responseKind === 'login-page' ||
    fields.responseKind === 'security-page' ||
    status >= 400
  ) {
    return 'ERROR'
  }
  if (event === 'config_save_rejected' || fields.willRetry === true) return 'WARN'
  return 'INFO'
}

function formatValue(value: DiagnosticValue): string {
  if (typeof value !== 'string') return String(value)
  return /^[a-z0-9._:/-]+$/i.test(value) ? value : JSON.stringify(value)
}
