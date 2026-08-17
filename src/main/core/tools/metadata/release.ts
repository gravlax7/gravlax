import type { Config } from '@shared/types/config'
import type { Release } from '@shared/types'
import { finalizeNormalizedRelease } from './normalization'
import { createProviders } from './providers'
import { deserializeReleaseID } from './search'

export { inferReleaseType } from './normalization'

export async function fetchNormalizedRelease(
  cfg: Config,
  providerName: string,
  releaseID: string,
  releaseURL: string,
  signal?: AbortSignal
): Promise<Release> {
  const provider = createProviders(cfg).find((candidate) => candidate.name === providerName)
  if (!provider) {
    throw new Error(`unknown provider ${providerName}`)
  }
  const id = deserializeReleaseID(releaseID)
  const raw = await provider.fetchData(releaseURL, id, signal)
  return finalizeNormalizedRelease(provider.mapRelease(raw, releaseURL))
}
