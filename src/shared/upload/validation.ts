import type { Config } from '@shared/types/config'
import type {
  HealthRow,
  TranscodeSnapshot,
  UploadFlowStateJSON,
  UploadSnapshot,
  UploadTrackerId
} from '@shared/types'
import { isNamedMainArtist } from './artists'
import { effectiveReleaseType, releaseTypeId } from './releaseTypes'

export function validateUploadReport(upload: UploadSnapshot): string | null {
  if ((upload.selectedTrackerIds ?? []).length === 0) {
    return 'Select at least one tracker destination.'
  }
  if (!(upload.title ?? '').trim()) return 'Title is required.'
  if (!(upload.artists ?? []).some(isNamedMainArtist)) {
    return 'At least one main artist is required.'
  }
  if (!upload.year || upload.year <= 0) return 'Year is required.'
  if (!(upload.media ?? '').trim()) return 'Media is required.'
  if (!(upload.tags ?? '').trim()) return 'Tags are required.'
  if ((upload.formats ?? []).length === 0) return 'No upload formats are prepared.'
  return null
}

/** Every selected transcode must finish before the upload payload is fixed. */
export function validateSelectedTranscodes(transcode: TranscodeSnapshot): string | null {
  if (transcode.phase === 'inspecting' || transcode.phase === 'running') {
    return 'Wait for transcoding to finish before uploading.'
  }

  const selected = [...new Set(transcode.selectedOptionIds ?? [])]
  if (selected.length === 0) return null

  const jobs = new Map((transcode.jobs ?? []).map((job) => [job.optionId, job]))
  const options = new Map((transcode.inspection?.options ?? []).map((option) => [option.id, option]))
  const missing = selected.filter((id) => {
    const job = jobs.get(id)
    return job?.status !== 'succeeded' || !(job.outputPath ?? '').trim()
  })
  if (missing.length === 0) return null

  const labels = missing.map((id) => options.get(id)?.name ?? id).join(', ')
  return `Prepare every selected format before uploading: ${labels}.`
}

/** The report must contain the source plus every selected, finished transcode. */
export function validatePreparedUploadFormats(
  state: Pick<UploadFlowStateJSON, 'transcode' | 'upload'>
): string | null {
  const transcodeError = validateSelectedTranscodes(state.transcode)
  if (transcodeError) return transcodeError

  const formatIds = new Set((state.upload.formats ?? []).map((format) => format.id))
  if (!formatIds.has('source')) return 'The source FLAC upload is not ready yet.'

  const missing = [...new Set(state.transcode.selectedOptionIds ?? [])].filter(
    (id) => !formatIds.has(id)
  )
  if (missing.length === 0) return null

  return 'The upload list is still updating with the prepared formats.'
}

const TRACKER_NAMES: Record<UploadTrackerId, string> = {
  redacted: 'Redacted',
  orpheus: 'Orpheus'
}

export type TrackerAuthMode = 'api' | 'session'

const TRACKER_AUTH_MODES: readonly TrackerAuthMode[] = ['api', 'session']

export function trackerHealthRowId(trackerId: UploadTrackerId, mode: TrackerAuthMode): string {
  return `trackers:${trackerId}:${mode}`
}

/** Trackers that still have at least one format left to submit. */
export function pendingUploadTrackerIds(upload: UploadSnapshot): UploadTrackerId[] {
  const done = new Set(
    (upload.submissions ?? [])
      .filter((submission) => submission.status === 'done')
      .map((submission) => submission.id)
  )

  return (upload.selectedTrackerIds ?? []).filter((trackerId) =>
    (upload.formats ?? []).some((format) => !done.has(`${trackerId}:${format.id}`))
  )
}

/** Return one combined error for every required tracker auth check that is not ready. */
export function validateTrackerHealth(
  rows: readonly HealthRow[] | null | undefined,
  trackerIds: readonly UploadTrackerId[]
): string | null {
  if (trackerIds.length === 0) return null
  if (!rows) return 'Waiting for tracker health checks to finish.'

  const byId = new Map(rows.map((row) => [row.id, row]))
  const failures: string[] = []
  let waiting = false
  for (const trackerId of trackerIds) {
    for (const mode of TRACKER_AUTH_MODES) {
      const row = byId.get(trackerHealthRowId(trackerId, mode))
      if (row?.status === 'available') continue
      if (!row || row.status === 'checking') {
        waiting = true
        continue
      }
      const label = `${TRACKER_NAMES[trackerId]} ${mode === 'api' ? 'API' : 'Session'}`
      failures.push(`${label}: ${row.detail ?? 'Not checked'}`)
    }
  }

  if (failures.length > 0) {
    return `Tracker health checks must pass before uploading: ${failures.join('; ')}.`
  }
  return waiting ? 'Waiting for tracker health checks to finish.' : null
}

/**
 * Every tracker destination needs both auth paths. The API handles normal
 * uploads, while the site session supports page uploads and reports.
 */
export function preflightTracker(
  cfg: Config,
  trackerId: UploadTrackerId
): string | null {
  const name = TRACKER_NAMES[trackerId]
  const tracker = cfg.trackers[trackerId]
  const apiKey = tracker.apiKey.trim()
  const cookie = tracker.sessionCookie.trim()

  if (!apiKey) {
    return `${name}: set an API key in Settings.`
  }
  if (!cookie) {
    return `${name}: set a session cookie in Settings.`
  }
  return null
}

/** Per-tracker checks `validateUploadReport` cannot make on its own. */
export function validateUploadTargets(
  upload: UploadSnapshot,
  cfg: Config,
  trackerIds: readonly UploadTrackerId[] = upload.selectedTrackerIds ?? []
): string | null {
  for (const trackerId of trackerIds) {
    const groupId = upload.groupIds?.[trackerId]
    const hasGroupId = typeof groupId === 'number' && Number.isFinite(groupId)

    const credentials = preflightTracker(cfg, trackerId)
    if (credentials) return credentials

    // Only a new group carries a release type; joining an existing one does not.
    const releaseType = effectiveReleaseType(upload, trackerId)
    if (!hasGroupId && releaseTypeId(trackerId, releaseType) === null) {
      return `Release type "${releaseType}" is not valid on ${TRACKER_NAMES[trackerId]}.`
    }
  }
  return null
}
