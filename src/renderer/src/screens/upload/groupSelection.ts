import { createMemo, type Accessor } from 'solid-js'
import type { UploadSnapshot, UploadTrackerId } from '@shared/types'
import { groupIdForTracker } from '@shared/upload/groupIds'

export function createSelectedGroupId(
  upload: Accessor<Pick<UploadSnapshot, 'groupIds'>>,
  trackerId: Accessor<UploadTrackerId>
): Accessor<number | null> {
  return createMemo(() => groupIdForTracker(upload(), trackerId()))
}
