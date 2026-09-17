import type { Config } from '@shared/types/config'
import type { UploadSnapshot, UploadTrackerId } from '@shared/types'
import { UPLOAD_TRACKER_IDS } from '@shared/trackers'
import { trackerHealthStore } from './trackerHealthStore'

export function reconcileUploadTrackerSelection(upload: UploadSnapshot, cfg: Config): UploadSnapshot {
  if (upload.phase === 'submitting' || upload.phase === 'done') return upload
  const selected = new Set(upload.selectedTrackerIds ?? [])
  const removed = new Set(upload.healthDeselectedTrackerIds ?? [])
  for (const id of UPLOAD_TRACKER_IDS) {
    if (!cfg.trackers[id].enabled) {
      selected.delete(id)
      removed.delete(id)
      continue
    }
    const rows = trackerHealthStore.rows(cfg, id)
    const failing = rows.some((row) => row.status === 'failing' || row.status === 'missing')
    if (failing && selected.delete(id)) removed.add(id)
    if (trackerHealthStore.ready(cfg, id) && removed.delete(id)) selected.add(id)
  }
  const nextSelected = UPLOAD_TRACKER_IDS.filter((id) => selected.has(id))
  const nextRemoved = UPLOAD_TRACKER_IDS.filter((id) => removed.has(id))
  if (same(upload.selectedTrackerIds, nextSelected) &&
      same(upload.healthDeselectedTrackerIds, nextRemoved)) return upload
  return { ...upload, selectedTrackerIds: nextSelected, healthDeselectedTrackerIds: nextRemoved }
}

function same(a: readonly UploadTrackerId[] | undefined, b: readonly UploadTrackerId[]): boolean {
  return (a ?? []).length === b.length && (a ?? []).every((id, index) => id === b[index])
}
