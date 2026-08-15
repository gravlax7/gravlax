import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_USER_AGENT } from '@main/core/tools/http'
import { fetchText } from '../http'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchText', () => {
  it('uses the neutral default user agent', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('User-Agent')).toBe(DEFAULT_USER_AGENT)
      return new Response('ok')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchText('https://example.test')).resolves.toBe('ok')
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('keeps an explicit user agent override', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('User-Agent')).toBe('custom-client/2.0')
      return new Response('ok')
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      fetchText('https://example.test', { headers: { 'User-Agent': 'custom-client/2.0' } })
    ).resolves.toBe('ok')
  })
})
