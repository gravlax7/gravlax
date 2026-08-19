import type { Config } from '@shared/types/config'
import type { HealthRow } from '@shared/types'
import type { ImageHostProvider } from './provider'
import { imageHostProviders } from './providers'

const PROBE_TIMEOUT_MS = 3000

function providersWithHealthcheck(providers: readonly ImageHostProvider[]) {
  return providers.flatMap((provider) => {
    const healthTarget = provider.healthTarget
    return healthTarget ? [{ provider, healthTarget }] : []
  })
}

export async function healthcheckImageHosts(
  cfg: Config,
  onRow?: (row: HealthRow) => void
): Promise<HealthRow[]> {
  const providers = providersWithHealthcheck(imageHostProviders)

  for (const { healthTarget } of providers) {
    const host = healthTarget(cfg)
    onRow?.({
      id: `img:${host.id}`,
      name: host.name,
      group: 'Image Hosts',
      status: host.enabled ? 'checking' : 'disabled',
      detail: host.enabled ? 'Checking…' : 'Disabled'
    })
  }

  return Promise.all(
    providers.map(async ({ provider, healthTarget }) => {
      const host = healthTarget(cfg)
      const row: HealthRow = {
        id: `img:${host.id}`,
        name: host.name,
        group: 'Image Hosts',
        status: 'checking'
      }
      if (!host.enabled) {
        const disabled = { ...row, status: 'disabled' as const, detail: 'Disabled' }
        onRow?.(disabled)
        return disabled
      }
      if (host.requiresApiKey && !host.apiKey) {
        const missing = { ...row, status: 'failing' as const, detail: 'Missing API key' }
        onRow?.(missing)
        return missing
      }
      if (await isReachable(host.url, host.headers)) {
        const apiKeyError = provider.validateApiKey
          ? await provider.validateApiKey(cfg)
          : null
        if (apiKeyError) {
          const failing = { ...row, status: 'failing' as const, detail: apiKeyError }
          onRow?.(failing)
          return failing
        }
        const available = { ...row, status: 'available' as const, detail: 'Available' }
        onRow?.(available)
        return available
      }
      const unreachable = { ...row, status: 'failing' as const, detail: 'Unreachable' }
      onRow?.(unreachable)
      return unreachable
    })
  )
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
