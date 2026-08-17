import { describe, expect, it, vi } from 'vitest'
import type { Config } from '@shared/types/config'
import type { MetadataBaseline } from '@shared/types'
import type { Provider, ReleaseResult } from '../base'
import { defaultConfig } from '@main/core/config/defaults'

vi.mock('../providers', () => {
  const definitions = [
    { name: 'MusicBrainz', enabled: true },
    { name: 'Deezer', enabled: true }
  ]
  let providers: Provider[] = []
  return {
    providerDefinitions: () => definitions,
    createProviders: () => providers,
    __setProviders: (next: Provider[]) => {
      providers = next
    }
  }
})

import { runMetaSearch } from '../search'
import * as providersModule from '../providers'

type ProvidersMock = typeof providersModule & {
  __setProviders: (next: Provider[]) => void
}

const { __setProviders } = providersModule as ProvidersMock

function baseline(): MetadataBaseline {
  return {
    artists: ['Artist'],
    title: 'Album',
    trackCount: 10,
    queryStrings: ['Artist Album']
  }
}

function cfg(): Config {
  return defaultConfig()
}

function mockProvider(
  name: string,
  search: (query: string) => Promise<ReleaseResult[]>
): Provider {
  return {
    name,
    async healthcheck() {},
    searchReleases: search,
    releaseIDFromURL: () => null,
    async fetchData() {
      return {}
    },
    mapRelease() {
      return {}
    },
    formatURL(releaseID) {
      return `https://example.test/${name}/${String(releaseID)}`
    }
  }
}

describe('runMetaSearch', () => {
  it('runs enabled providers in parallel and keeps going when one fails', async () => {
    let releaseSlow: () => void = () => {}
    const slowStarted = new Promise<void>((resolve) => {
      releaseSlow = resolve
    })

    const order: string[] = []

    __setProviders([
      mockProvider('MusicBrainz', async () => {
        order.push('MusicBrainz:start')
        await slowStarted
        order.push('MusicBrainz:end')
        return [
          {
            id: 'mb-1',
            ident: { artist: 'Artist', album: 'Album', trackCount: 10, source: 'CD' },
            display: 'Artist - Album'
          }
        ]
      }),
      mockProvider('Deezer', async () => {
        order.push('Deezer:start')
        order.push('Deezer:fail')
        throw new Error('deezer unavailable')
      })
    ])

    const progress: string[][] = []
    const done = runMetaSearch(cfg(), baseline(), (providers) => {
      progress.push(providers.map((p) => `${p.provider}:${p.status}`))
    })

    await Promise.resolve()
    expect(order).toEqual(expect.arrayContaining(['MusicBrainz:start', 'Deezer:start']))

    releaseSlow()
    const results = await done

    const byName = Object.fromEntries(results.map((r) => [r.provider, r]))
    expect(byName.MusicBrainz?.status).toBe('matched')
    expect(byName.MusicBrainz?.results).toHaveLength(1)
    expect(byName.Deezer?.status).toBe('failed')
    expect(byName.Deezer?.error).toContain('deezer unavailable')
    expect(order).toContain('MusicBrainz:end')
    expect(progress.at(-1)).toEqual(['MusicBrainz:matched', 'Deezer:failed'])
  })

  it('keeps successful query results when another query for the same provider fails', async () => {
    __setProviders([
      mockProvider('MusicBrainz', async (query) => {
        if (query.includes('fail')) throw new Error('query failed')
        return [
          {
            id: 'mb-ok',
            ident: { artist: 'Artist', album: 'Album', trackCount: 10, source: 'CD' },
            display: 'Artist - Album'
          }
        ]
      }),
      mockProvider('Deezer', async () => [])
    ])

    const results = await runMetaSearch(
      cfg(),
      { ...baseline(), queryStrings: ['Artist Album', 'fail query'] },
      () => {}
    )

    expect(results.find((r) => r.provider === 'MusicBrainz')?.status).toBe('matched')
  })

  it('does not let a progress callback failure abort other providers', async () => {
    __setProviders([
      mockProvider('MusicBrainz', async () => [
        {
          id: 'mb-1',
          ident: { artist: 'Artist', album: 'Album', trackCount: 10, source: 'CD' },
          display: 'Artist - Album'
        }
      ]),
      mockProvider('Deezer', async () => {
        throw new Error('deezer down')
      })
    ])

    let calls = 0
    const results = await runMetaSearch(cfg(), baseline(), () => {
      calls++
      if (calls > 1) throw new Error('progress exploded')
    })

    expect(results.find((r) => r.provider === 'MusicBrainz')?.status).toBe('matched')
    expect(results.find((r) => r.provider === 'Deezer')?.status).toBe('failed')
  })
})
