import type { Config } from '@shared/types/config'
import type {
  MetadataBaseline,
  MetadataProviderResults,
  MetadataSearchResult,
  MetadataUrlResolution
} from '@shared/types'
import type { Provider, ReleaseResult } from './base'
import { displayIdentifier } from './base'
import { createProviders, providerDefinitions } from './providers'

const DEFAULT_SEARCH_LIMIT = 10

const UNSUPPORTED_URL_ERROR =
  'Enter a MusicBrainz release URL or a Deezer album URL.'

export function resolveMetadataUrl(cfg: Config, rawURL: string): MetadataUrlResolution {
  const value = rawURL.trim()
  if (!value) return { ok: false, error: UNSUPPORTED_URL_ERROR }

  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, error: UNSUPPORTED_URL_ERROR }
  }

  for (const provider of createProviders(cfg)) {
    const releaseID = provider.releaseIDFromURL(url)
    if (releaseID == null) continue
    return {
      ok: true,
      selection: {
        provider: provider.name,
        releaseId: serializeReleaseID(releaseID),
        url: provider.formatURL(releaseID, '', '')
      }
    }
  }

  return { ok: false, error: UNSUPPORTED_URL_ERROR }
}

export function providerPlaceholders(cfg: Config): MetadataProviderResults[] {
  return providerDefinitions(cfg).map((definition) => ({
    provider: definition.name,
    status: definition.enabled ? 'queued' : 'inactive'
  }))
}

export async function runMetaSearch(
  cfg: Config,
  baseline: MetadataBaseline,
  onProgress: (providers: MetadataProviderResults[]) => void,
  signal?: AbortSignal
): Promise<MetadataProviderResults[]> {
  const definitions = providerDefinitions(cfg)
  const providers = createProviders(cfg)
  const byName = new Map(providers.map((p) => [p.name, p]))

  const results: MetadataProviderResults[] = definitions.map((definition) => ({
    provider: definition.name,
    status: definition.enabled ? 'queued' : 'inactive'
  }))

  const emit = (): void => {
    try {
      onProgress(clone(results))
    } catch {
      /* progress must not fail the overall search */
    }
  }

  emit()

  const settled = await Promise.allSettled(
    definitions.map(async (definition, index) => {
      if (!definition.enabled) return

      const provider = byName.get(definition.name)
      if (!provider) {
        results[index] = {
          provider: definition.name,
          status: 'failed',
          error: 'provider is not available'
        }
        emit()
        return
      }

      results[index] = { provider: definition.name, status: 'running' }
      emit()

      results[index] = await searchProvider(provider, baseline, signal)
      emit()
    })
  )

  for (let index = 0; index < settled.length; index++) {
    const outcome = settled[index]
    if (!outcome || outcome.status !== 'rejected') continue
    const definition = definitions[index]
    if (!definition?.enabled) continue
    if (results[index]?.status === 'matched' || results[index]?.status === 'empty') continue
    results[index] = {
      provider: definition.name,
      status: 'failed',
      error: String(outcome.reason)
    }
  }

  return clone(results)
}

async function searchProvider(
  provider: Provider,
  baseline: MetadataBaseline,
  signal?: AbortSignal
): Promise<MetadataProviderResults> {
  try {
    const found = await runProviderSearches(provider, baseline.queryStrings ?? [], signal)
    const filtered = filterSearchResults(provider, found, baseline)
    return {
      provider: provider.name,
      status: filtered.length === 0 ? 'empty' : 'matched',
      results: filtered
    }
  } catch (err) {
    return {
      provider: provider.name,
      status: 'failed',
      error: String(err)
    }
  }
}

async function runProviderSearches(
  provider: Provider,
  queryStrings: string[],
  signal?: AbortSignal
): Promise<ReleaseResult[]> {
  if (queryStrings.length === 0) return []

  const settled = await Promise.allSettled(
    queryStrings.map((query) => provider.searchReleases(query, DEFAULT_SEARCH_LIMIT, signal))
  )

  const combined: ReleaseResult[] = []
  let firstRejection: unknown
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      combined.push(...result.value)
      continue
    }
    if (firstRejection === undefined) {
      firstRejection = result.reason
    }
  }

  if (combined.length === 0 && firstRejection !== undefined) {
    throw firstRejection
  }
  return combined
}

function filterSearchResults(
  provider: Provider,
  results: ReleaseResult[],
  baseline: MetadataBaseline
): MetadataSearchResult[] {
  const filtered: MetadataSearchResult[] = []
  const seen = new Set<string>()
  for (const result of results) {
    if (!matchesTrackCount(result.ident.trackCount, baseline.trackCount)) continue
    const releaseId = serializeReleaseID(result.id)
    const url = provider.formatURL(result.id, result.ident.album, '')
    const key = `${url}\0${releaseId}\0${normalizeDisplay(result.display)}`
    if (seen.has(key)) continue
    seen.add(key)
    filtered.push({
      provider: provider.name,
      releaseId,
      url,
      display: result.display,
      artist: result.ident.artist,
      album: result.ident.album,
      year: result.ident.year,
      trackCount: result.ident.trackCount,
      source: result.ident.source
    })
  }
  return filtered
}

function matchesTrackCount(resultCount: number | undefined, baselineCount: number | undefined): boolean {
  if (resultCount == null || baselineCount == null || baselineCount <= 0) return true
  return Math.abs(resultCount - baselineCount) <= 1
}

function normalizeDisplay(display: string): string {
  return displayIdentifier(display).toLowerCase().replace(/\s+/g, ' ').trim()
}

export function serializeReleaseID(id: unknown): string {
  return JSON.stringify(id ?? null)
}

export function deserializeReleaseID(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function clone(providers: MetadataProviderResults[]): MetadataProviderResults[] {
  return structuredClone(providers)
}
