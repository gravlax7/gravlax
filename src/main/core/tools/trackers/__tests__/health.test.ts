import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import { resetTrackerRateLimiter } from '../gazelle'
import { healthcheckTrackers, trackerHealthRowsReady } from '../health'

afterEach(() => {
  resetTrackerRateLimiter()
  vi.unstubAllGlobals()
})

function okIndex(): string {
  return JSON.stringify({
    status: 'success',
    response: { authkey: 'ak', passkey: 'pk' }
  })
}

function stubFetch(handler: (headers: Headers) => { status: number; text: string }): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async (_input: string, init?: RequestInit) => {
    const result = handler(new Headers(init?.headers))
    return {
      status: result.status,
      ok: result.status >= 200 && result.status < 300,
      url: 'https://redacted.example/ajax.php?action=index',
      text: async () => result.text,
      headers: { get: () => null, getSetCookie: () => [] }
    }
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

function config() {
  const cfg = defaultConfig()
  cfg.trackers.redacted = {
    ...cfg.trackers.redacted,
    enabled: true,
    siteUrl: 'https://redacted.example',
    announceUrl: 'https://announce.redacted.example',
    apiKey: 'api-key',
    sessionCookie: 'session-cookie'
  }
  return cfg
}

describe('healthcheckTrackers', () => {
  it('checks API and session independently without auth fallback', async () => {
    const calls = stubFetch((headers) => {
      if (headers.get('Authorization') === 'api-key') return { status: 200, text: okIndex() }
      return { status: 200, text: JSON.stringify({ status: 'failure', error: 'expired session' }) }
    })

    const rows = await healthcheckTrackers(config())

    expect(rows).toMatchObject([
      { id: 'trackers:redacted:api', name: 'Redacted API', status: 'available' },
      {
        id: 'trackers:redacted:session',
        name: 'Redacted Session',
        status: 'failing',
        detail: 'expired session'
      },
      { id: 'trackers:orpheus:api', status: 'disabled' },
      { id: 'trackers:orpheus:session', status: 'disabled' }
    ])
    expect(calls).toHaveBeenCalledTimes(2)

    const headers = calls.mock.calls.map(([, init]) => new Headers((init as RequestInit | undefined)?.headers))
    expect(headers.some((value) => value.get('Authorization') === 'api-key' && value.get('Cookie') === null)).toBe(true)
    expect(headers.some((value) => value.get('Authorization') === null && value.get('Cookie') === 'session=session-cookie')).toBe(true)
  })

  it('fails a blank credential without a request and keeps disabled tracker rows', async () => {
    const cfg = config()
    cfg.trackers.redacted.apiKey = ''
    const calls = stubFetch(() => ({ status: 200, text: okIndex() }))

    const rows = await healthcheckTrackers(cfg)

    expect(rows).toMatchObject([
      { id: 'trackers:redacted:api', status: 'failing', detail: 'Missing API key' },
      { id: 'trackers:redacted:session', status: 'available' },
      { id: 'trackers:orpheus:api', status: 'disabled' },
      { id: 'trackers:orpheus:session', status: 'disabled' }
    ])
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('requires every auth row for enabled trackers to pass', () => {
    expect(trackerHealthRowsReady([])).toBe(false)
    expect(
      trackerHealthRowsReady([
        { id: 'trackers:redacted:api', name: 'Redacted API', status: 'available' },
        { id: 'trackers:redacted:session', name: 'Redacted Session', status: 'available' },
        { id: 'trackers:orpheus:api', name: 'Orpheus API', status: 'disabled' },
        { id: 'trackers:orpheus:session', name: 'Orpheus Session', status: 'disabled' }
      ])
    ).toBe(true)
    expect(
      trackerHealthRowsReady([
        { id: 'trackers:redacted:api', name: 'Redacted API', status: 'available' },
        { id: 'trackers:redacted:session', name: 'Redacted Session', status: 'failing' }
      ])
    ).toBe(false)
  })
})
