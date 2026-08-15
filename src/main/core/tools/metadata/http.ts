import { DEFAULT_USER_AGENT } from '@main/core/tools/http'

export async function fetchText(
  url: string,
  options: {
    query?: Record<string, string>
    headers?: Record<string, string>
    signal?: AbortSignal
    timeoutMs?: number
    redirect?: 'follow' | 'error' | 'manual'
  } = {}
): Promise<string> {
  const parsed = new URL(url)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value) parsed.searchParams.set(key, value)
  }
  const headers = new Headers(options.headers)
  if (!headers.has('User-Agent')) headers.set('User-Agent', DEFAULT_USER_AGENT)

  const timeout = options.timeoutMs && options.timeoutMs > 0 ? AbortSignal.timeout(options.timeoutMs) : undefined
  const signals = [options.signal, timeout].filter(Boolean) as AbortSignal[]
  const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0]

  const response = await fetch(parsed.toString(), {
    signal,
    redirect: options.redirect ?? 'follow',
    headers
  })

  const body = await response.text()
  if (response.status < 200 || response.status >= 300) {
    const trimmed = body.trim()
    throw new Error(
      trimmed
        ? `request failed with status ${response.status}: ${trimmed}`
        : `request failed with status ${response.status}`
    )
  }
  return body
}

export async function fetchJSON<T = unknown>(
  url: string,
  options?: Parameters<typeof fetchText>[1]
): Promise<T> {
  const body = await fetchText(url, options)
  return JSON.parse(body) as T
}

export function timeoutMsFromConfig(seconds: number): number {
  return Math.max(1, seconds || 10) * 1000
}
