import type { UpdateCheckResult } from '@shared/types'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'

const LATEST_RELEASE_URL = 'https://api.github.com/repos/gravlax7/gravlax/releases/latest'
const RELEASE_PAGE_ROOT = 'https://github.com/gravlax7/gravlax/releases/tag/'
const UPDATE_TIMEOUT_MS = 5_000

type Version = readonly [number, number, number]

export interface UpdateCheckOptions {
  currentVersion: string
  fetch?: typeof globalThis.fetch
}

export async function checkForUpdate(options: UpdateCheckOptions): Promise<UpdateCheckResult> {
  const { currentVersion } = options
  const current = parseVersion(currentVersion)
  if (!current) return { status: 'error', currentVersion }

  try {
    const response = await (options.fetch ?? globalThis.fetch)(LATEST_RELEASE_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': DEFAULT_USER_AGENT
      },
      signal: AbortSignal.timeout(UPDATE_TIMEOUT_MS)
    })
    if (!response.ok) return { status: 'error', currentVersion }

    const release: unknown = await response.json()
    if (!isStableRelease(release)) return { status: 'error', currentVersion }

    const latest = parseVersion(release.tag_name)
    if (!latest) return { status: 'error', currentVersion }
    if (compareVersions(latest, current) <= 0) return { status: 'up-to-date', currentVersion }

    return {
      status: 'available',
      currentVersion,
      latestVersion: release.tag_name.slice(1),
      releaseUrl: releasePageUrl(release.tag_name)
    }
  } catch {
    return { status: 'error', currentVersion }
  }
}

export function compareVersions(a: Version, b: Version): number {
  for (let index = 0; index < a.length; index += 1) {
    const difference = a[index]! - b[index]!
    if (difference !== 0) return difference
  }
  return 0
}

export function releasePageUrl(tag: string): string {
  return `${RELEASE_PAGE_ROOT}${encodeURIComponent(tag)}`
}

function parseVersion(value: string): Version | null {
  const match = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function isStableRelease(value: unknown): value is { tag_name: string; draft?: boolean; prerelease?: boolean } {
  if (!value || typeof value !== 'object') return false
  const release = value as Record<string, unknown>
  return (
    typeof release.tag_name === 'string' &&
    release.draft !== true &&
    release.prerelease !== true
  )
}
