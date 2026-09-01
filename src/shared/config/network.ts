export function isHTTPSURL(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' && parsed.hostname !== ''
  } catch {
    return false
  }
}

const URL_SCHEME = /^([a-z][a-z\d+.-]*):\/\//i

/**
 * Turns a bare tracker host or pasted HTTP(S) URL into the value stored in config.
 * Invalid input is kept, after trimming, so validation can report it to the user.
 */
export function normalizeTrackerHost(raw: string): string {
  const value = raw.trim()
  if (value === '') return ''

  const schemeMatch = URL_SCHEME.exec(value)
  const scheme = schemeMatch?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') return value

  try {
    const parsed = new URL(scheme ? value : `https://${value}`)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return value
    const authority = value
      .slice(schemeMatch?.[0].length ?? 0)
      .split(/[/?#]/, 1)[0]!
      .split('@')
      .at(-1)!
    const port = authority.startsWith('[')
      ? /^\[[^\]]+\]:(\d+)$/.exec(authority)?.[1]
      : /:(\d+)$/.exec(authority)?.[1]
    return port ? `${parsed.hostname}:${Number(port)}` : parsed.hostname
  } catch {
    return value
  }
}

export function isTrackerHost(raw: string): boolean {
  if (raw === '' || raw !== raw.trim() || normalizeTrackerHost(raw) !== raw) return false
  try {
    const parsed = new URL(`https://${raw}`)
    return (
      parsed.hostname !== '' &&
      parsed.username === '' &&
      parsed.password === '' &&
      parsed.pathname === '/' &&
      parsed.search === '' &&
      parsed.hash === ''
    )
  } catch {
    return false
  }
}

export function trackerHTTPSURL(raw: string): string {
  const host = normalizeTrackerHost(raw)
  return isTrackerHost(host) ? `https://${host}` : ''
}

export function isSafeQBittorrentURL(raw: string, allowInsecureHTTP = false): boolean {
  try {
    const parsed = new URL(raw)
    if (parsed.hostname === '') return false
    if (parsed.protocol === 'https:') return true
    if (parsed.protocol !== 'http:') return false
    return (
      isLoopbackHostname(parsed.hostname) ||
      (allowInsecureHTTP && isPrivateIPAddress(parsed.hostname))
    )
  } catch {
    return false
  }
}

export function isPrivateIPAddress(raw: string): boolean {
  const hostname = raw.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname.includes(':') && /^f[cd]/.test(hostname)) return true

  const octets = hostname.split('.')
  if (
    octets.length !== 4 ||
    !octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  ) {
    return false
  }

  const first = Number(octets[0])
  const second = Number(octets[1])
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}

export function isLoopbackHostname(raw: string): boolean {
  const hostname = raw.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (hostname === 'localhost' || hostname === '::1') return true

  const octets = hostname.split('.')
  return (
    octets.length === 4 &&
    octets[0] === '127' &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  )
}
