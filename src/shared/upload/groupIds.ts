import type { UploadSnapshot, UploadTrackerId } from '@shared/types'
import { isUploadTrackerId } from '@shared/trackers'

export function emptyGroupIds(): Partial<Record<UploadTrackerId, number | null>> {
  return {}
}

export function groupIdForTracker(
  upload: Pick<UploadSnapshot, 'groupIds'>,
  trackerId: UploadTrackerId
): number | null {
  const value = upload.groupIds?.[trackerId]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

export function withGroupIdForTracker(
  groupIds: Partial<Record<UploadTrackerId, number | null>> | undefined,
  trackerId: UploadTrackerId,
  groupId: number | null
): Partial<Record<UploadTrackerId, number | null>> {
  return {
    ...(groupIds ?? {}),
    [trackerId]: groupId
  }
}

export function selectedTrackersWithGroupIds(
  upload: Pick<UploadSnapshot, 'selectedTrackerIds' | 'groupIds'>
): UploadTrackerId[] {
  return (upload.selectedTrackerIds ?? [])
    .filter(isUploadTrackerId)
    .filter((id) => groupIdForTracker(upload, id) != null)
}

export function anySelectedTrackerHasGroupId(
  upload: Pick<UploadSnapshot, 'selectedTrackerIds' | 'groupIds'>
): boolean {
  return selectedTrackersWithGroupIds(upload).length > 0
}

export function allSelectedTrackersHaveGroupId(
  upload: Pick<UploadSnapshot, 'selectedTrackerIds' | 'groupIds'>
): boolean {
  const selected = (upload.selectedTrackerIds ?? []).filter(isUploadTrackerId)
  if (selected.length === 0) return false
  return selected.every((id) => groupIdForTracker(upload, id) != null)
}
