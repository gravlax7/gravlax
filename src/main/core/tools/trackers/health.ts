import type { Config } from '@shared/types/config'
import type { HealthRow, UploadTrackerId } from '@shared/types'
import {
  trackerHealthRowId,
  type TrackerAuthMode
} from '@shared/upload/validation'
import { createTrackers, trackerDefinitions } from './index'

const AUTH_MODES: readonly TrackerAuthMode[] = ['api', 'session']

export async function healthcheckTrackers(
  cfg: Config,
  trackerIds?: readonly UploadTrackerId[]
): Promise<HealthRow[]> {
  const selected = trackerIds ? new Set(trackerIds) : null
  const definitions = trackerDefinitions(cfg).filter((definition) => selected?.has(definition.id) ?? true)
  const byId = new Map(createTrackers(cfg).map((tracker) => [tracker.id, tracker]))

  return Promise.all(
    definitions.flatMap((definition) =>
      AUTH_MODES.map(async (mode): Promise<HealthRow> => {
        const row: HealthRow = {
          id: trackerHealthRowId(definition.id, mode),
          name: `${definition.name} ${mode === 'api' ? 'API' : 'Session'}`,
          group: 'Trackers',
          status: 'checking'
        }

        if (!definition.enabled) {
          return { ...row, status: 'disabled', detail: 'Disabled' }
        }

        const credential =
          mode === 'api'
            ? cfg.trackers[definition.id].apiKey.trim()
            : cfg.trackers[definition.id].sessionCookie.trim()
        if (!credential) {
          return {
            ...row,
            status: 'failing',
            detail: mode === 'api' ? 'Missing API key' : 'Missing session cookie'
          }
        }

        const tracker = byId.get(definition.id)
        if (!tracker) {
          return { ...row, status: 'failing', detail: 'Tracker unavailable' }
        }

        try {
          await tracker.healthcheck(mode)
          return { ...row, status: 'available', detail: 'Available' }
        } catch (err) {
          return {
            ...row,
            status: 'failing',
            detail: err instanceof Error ? err.message : String(err)
          }
        }
      })
    )
  )
}

export function trackerHealthRowsReady(rows: readonly HealthRow[]): boolean {
  const enabledRows = rows.filter((row) => row.status !== 'disabled')
  return enabledRows.length > 0 && enabledRows.every((row) => row.status === 'available')
}
