export function isHTTPSURL(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' && parsed.hostname !== ''
  } catch {
    return false
  }
}

export function isSafeQBittorrentURL(raw: string): boolean {
  try {
    const parsed = new URL(raw)
    if (parsed.hostname === '') return false
    if (parsed.protocol === 'https:') return true
    return parsed.protocol === 'http:' && isLoopbackHostname(parsed.hostname)
  } catch {
    return false
  }
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
