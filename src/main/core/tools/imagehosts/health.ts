import type { Config } from '@shared/types/config'
import type { HealthRow } from '@shared/types'
import { imageHostProviders } from './providers'

const PROBE_TIMEOUT_MS = 3000

export async function healthcheckImageHosts(cfg: Config): Promise<HealthRow[]> {
  const rows: HealthRow[] = []
  await Promise.all(
    imageHostProviders.map(async (provider) => {
      const host = provider.healthTarget(cfg)
      const row: HealthRow = {
        id: `img:${host.id}`,
        name: host.name,
        group: 'Image Hosts',
        status: 'checking'
      }
      if (!host.enabled) {
        row.status = 'disabled'
        row.detail = 'Disabled'
        rows.push(row)
        return
      }
      if (host.blockedReason) {
        row.status = 'failing'
        row.detail = host.blockedReason
        rows.push(row)
        return
      }
      if (host.requiresApiKey && !host.apiKey) {
        row.status = 'failing'
        row.detail = 'Missing API key'
        rows.push(row)
        return
      }
      if (await isReachable(host.url, host.headers)) {
        const apiKeyError = provider.validateApiKey
          ? await provider.validateApiKey(cfg)
          : null
        if (apiKeyError) {
          row.status = 'failing'
          row.detail = apiKeyError
        } else {
          row.status = 'available'
          row.detail = 'Available'
        }
      } else {
        row.status = 'failing'
        row.detail = 'Unreachable'
      }
      rows.push(row)
    })
  )
  return rows
}

/**
 * These are POST-only upload endpoints, so a GET probe legitimately answers
 * with a 4xx — any completed HTTP response means the host is up. Only a failed
 * connection (DNS, refused, timeout) counts as unreachable, so a genuinely down
 * host no longer reports as "available".
 */
async function isReachable(url: string, headers?: Record<string, string>): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS)
    })
    // Drain the body so the connection can be released.
    await response.arrayBuffer().catch(() => undefined)
    return true
  } catch {
    return false
  }
}
