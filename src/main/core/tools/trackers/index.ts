import type { Config } from '@shared/types/config'
import type { TrackerAuthMode } from '@shared/upload/validation'
import type { GazelleClient } from './gazelle'
import { createOrpheusTracker } from './orpheus'
import { createRedactedTracker } from './redacted'
import type {
  TrackerId,
  TrackerUploadData,
  TrackerUploadFiles,
  TrackerUploadResult
} from './types'

export type { TrackerId } from './types'
export type {
  LogcheckerInput,
  LogcheckerResult,
  LogcheckerChecksum,
  TrackerUploadData,
  TrackerUploadFiles,
  TrackerUploadResult
} from './types'

export interface Tracker {
  id: TrackerId
  name: string
  client: GazelleClient
  healthcheck(mode: TrackerAuthMode, signal?: AbortSignal): Promise<void>
  upload(
    data: TrackerUploadData,
    files: TrackerUploadFiles,
    signal?: AbortSignal
  ): Promise<TrackerUploadResult>
  reportLossyMaster(
    torrentId: number,
    comment: string,
    source: string,
    signal?: AbortSignal
  ): Promise<void>
}

export interface TrackerDefinition {
  id: TrackerId
  name: string
  enabled: boolean
}

export function trackerDefinitions(cfg: Config): TrackerDefinition[] {
  return [
    { id: 'redacted', name: 'Redacted', enabled: cfg.trackers.redacted.enabled },
    { id: 'orpheus', name: 'Orpheus', enabled: cfg.trackers.orpheus.enabled }
  ]
}

export function createTrackers(cfg: Config): Tracker[] {
  const timeoutMs = Math.max(1, cfg.metadataProviders.requestTimeoutSeconds || 10) * 1000
  return [
    createRedactedTracker(cfg.trackers.redacted, timeoutMs),
    createOrpheusTracker(cfg.trackers.orpheus, timeoutMs)
  ]
}

export function createEnabledTrackers(cfg: Config): Tracker[] {
  const definitions = trackerDefinitions(cfg)
  const byId = new Map(createTrackers(cfg).map((t) => [t.id, t]))
  return definitions.filter((d) => d.enabled).map((d) => byId.get(d.id)!).filter(Boolean)
}
