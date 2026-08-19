import type { Config } from '@shared/types/config'
import type { HealthRow, UploadTrackerId } from '@shared/types'
import {
  trackerHealthRowId,
  type TrackerAuthMode
} from '@shared/upload/validation'
import {
  createTrackers,
  trackerDefinitions,
  type Tracker,
  type TrackerDefinition
} from './index'
import { diagnosticError, logDiagnostic } from '@main/core/diagnosticLog'

const AUTH_MODES: readonly TrackerAuthMode[] = ['api', 'session']
const TRACKER_HEALTH_TIMEOUT_MS = 30_000
let nextHealthRunId = 0

export type TrackerHealthSource = 'startup' | 'settings-save' | 'manual' | 'upload' | 'other'

export async function healthcheckTrackers(
  cfg: Config,
  trackerIds?: readonly UploadTrackerId[],
  source: TrackerHealthSource = 'other',
  onRow?: (row: HealthRow) => void
): Promise<HealthRow[]> {
  const runId = ++nextHealthRunId
  const selected = trackerIds ? new Set(trackerIds) : null
  const definitions = trackerDefinitions(cfg).filter((definition) => selected?.has(definition.id) ?? true)
  const byId = new Map(createTrackers(cfg).map((tracker) => [tracker.id, tracker]))

  const groups = await Promise.all(
    definitions.map(async (definition) => {
      const tracker = byId.get(definition.id)
      for (const mode of AUTH_MODES) {
        onRow?.(pendingTrackerRow(definition, mode))
      }
      const rows: HealthRow[] = []
      for (const mode of AUTH_MODES) {
        const row = await checkTrackerAuthentication({
          cfg,
          definition,
          tracker,
          mode,
          runId,
          source
        })
        onRow?.(row)
        rows.push(row)
      }
      return rows
    })
  )
  return groups.flat()
}

function pendingTrackerRow(definition: TrackerDefinition, mode: TrackerAuthMode): HealthRow {
  return {
    id: trackerHealthRowId(definition.id, mode),
    name: `${definition.name} ${mode === 'api' ? 'API' : 'Session'}`,
    group: 'Trackers',
    status: definition.enabled ? 'checking' : 'disabled',
    detail: definition.enabled ? 'Checking…' : 'Disabled'
  }
}

async function checkTrackerAuthentication(options: {
  cfg: Config
  definition: TrackerDefinition
  tracker?: Tracker
  mode: TrackerAuthMode
  runId: number
  source: TrackerHealthSource
}): Promise<HealthRow> {
  const { cfg, definition, tracker, mode, runId, source } = options
  const started = Date.now()
  const row: HealthRow = {
    id: trackerHealthRowId(definition.id, mode),
    name: `${definition.name} ${mode === 'api' ? 'API' : 'Session'}`,
    group: 'Trackers',
    status: 'checking'
  }
  const logResult = (
    result: string,
    fields: ReturnType<typeof diagnosticError> = {}
  ): void => {
    logDiagnostic('tracker_auth', {
      runId,
      source,
      tracker: definition.id,
      mode,
      result,
      elapsedMs: Date.now() - started,
      ...fields
    })
  }

  if (!definition.enabled) return { ...row, status: 'disabled', detail: 'Disabled' }

  const credential =
    mode === 'api'
      ? cfg.trackers[definition.id].apiKey.trim()
      : cfg.trackers[definition.id].sessionCookie.trim()
  if (!credential) {
    logResult('failing', { errorKind: 'missing_credential' })
    return {
      ...row,
      status: 'failing',
      detail: mode === 'api' ? 'Missing API key' : 'Missing session cookie'
    }
  }

  if (!tracker) {
    logResult('failing', { errorKind: 'tracker_unavailable' })
    return { ...row, status: 'failing', detail: 'Tracker unavailable' }
  }

  try {
    await tracker.healthcheck(mode, AbortSignal.timeout(TRACKER_HEALTH_TIMEOUT_MS))
    logResult('available')
    return { ...row, status: 'available', detail: 'Available' }
  } catch (err) {
    logResult('failing', diagnosticError(err))
    return {
      ...row,
      status: 'failing',
      detail: err instanceof Error ? err.message : String(err)
    }
  }
}

export function trackerHealthRowsReady(rows: readonly HealthRow[]): boolean {
  const enabledRows = rows.filter((row) => row.status !== 'disabled')
  return enabledRows.length > 0 && enabledRows.every((row) => row.status === 'available')
}
