import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import { checkForUpdate, compareVersions, releasePageUrl } from '../updateCheck'

const currentVersion = '0.3.0'

function release(tag_name: unknown, extra: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({ tag_name, ...extra }))
}

function fetchResult(response: Response): typeof fetch {
  return vi.fn().mockResolvedValue(response) as unknown as typeof fetch
}

describe('update checks', () => {
  it('returns a trusted release page for a newer stable release', async () => {
    const fetch = fetchResult(release('v0.4.0'))

    await expect(checkForUpdate({ currentVersion, fetch })).resolves.toEqual({
      status: 'available',
      currentVersion,
      latestVersion: '0.4.0',
      releaseUrl: 'https://github.com/gravlax7/gravlax/releases/tag/v0.4.0'
    })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/gravlax7/gravlax/releases/latest',
      expect.objectContaining({
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': DEFAULT_USER_AGENT
        },
        signal: expect.any(AbortSignal)
      })
    )
  })

  it.each(['v0.3.0', 'v0.2.9'])('treats %s as up to date', async (tag_name) => {
    await expect(checkForUpdate({ currentVersion, fetch: fetchResult(release(tag_name)) })).resolves.toEqual({
      status: 'up-to-date',
      currentVersion
    })
  })

  it.each([
    [release('0.4.0-beta')],
    [release(undefined)],
    [release('v0.4.0', { prerelease: true })],
    [new Response('', { status: 500 })]
  ])('returns an error for invalid or unavailable release data', async (response) => {
    await expect(checkForUpdate({ currentVersion, fetch: fetchResult(response) })).resolves.toEqual({
      status: 'error',
      currentVersion
    })
  })

  it('returns an error when the request times out', async () => {
    const fetch = vi.fn().mockRejectedValue(new Error('timed out')) as unknown as typeof globalThis.fetch

    await expect(checkForUpdate({ currentVersion, fetch })).resolves.toEqual({
      status: 'error',
      currentVersion
    })
  })

  it('compares semantic versions and constructs release URLs safely', () => {
    expect(compareVersions([1, 2, 0], [1, 1, 9])).toBeGreaterThan(0)
    expect(compareVersions([1, 2, 0], [1, 2, 0])).toBe(0)
    expect(releasePageUrl('v1.2.3/test')).toBe(
      'https://github.com/gravlax7/gravlax/releases/tag/v1.2.3%2Ftest'
    )
  })
})
