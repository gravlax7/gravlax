import type {
  MetadataBaseline,
  MetadataProviderResults,
  MetadataSearchSnapshot,
  MetadataSelection
} from '@shared/types'
import { METADATA_PROVIDER_MANUAL } from '@shared/types/upload'
import type { State } from './state'

export function manualMetadataSelection(): MetadataSelection {
  return { provider: METADATA_PROVIDER_MANUAL }
}

export function isManualSelection(s: MetadataSelection): boolean {
  return s.provider === METADATA_PROVIDER_MANUAL
}

export function metadata(s: State): MetadataSearchSnapshot {
  return structuredClone(s.metadata)
}

export function setMetadataBaseline(s: State, baseline: MetadataBaseline): State {
  return { ...s, metadata: { ...s.metadata, baseline } }
}

export function setMetadataProviders(s: State, providers: MetadataProviderResults[]): State {
  return { ...s, metadata: { ...s.metadata, providers: cloneMetadataProviders(providers) } }
}

export function setMetadataSelection(s: State, selection: MetadataSelection): State {
  return { ...s, metadata: { ...s.metadata, selected: { ...selection } } }
}

export function clearMetadataSelection(s: State): State {
  return { ...s, metadata: { ...s.metadata, selected: null } }
}

export function setMetadata(s: State, snapshot: MetadataSearchSnapshot): State {
  return { ...s, metadata: restoreMetadata(snapshot) }
}

export function restoreMetadata(snapshot: MetadataSearchSnapshot): MetadataSearchSnapshot {
  const providers = cloneMetadataProviders(snapshot.providers ?? [])
  for (const provider of providers) {
    if (provider.status === 'running') {
      provider.status = 'queued'
      provider.error = ''
      provider.results = undefined
    }
  }
  return {
    ...snapshot,
    providers: providers.length > 0 ? providers : undefined,
    selected: snapshot.selected ? { ...snapshot.selected } : snapshot.selected
  }
}

function cloneMetadataProviders(providers: MetadataProviderResults[]): MetadataProviderResults[] {
  if (providers.length === 0) return []
  return providers.map((provider) => ({
    ...provider,
    results: provider.results ? provider.results.map((r) => ({ ...r })) : undefined
  }))
}
