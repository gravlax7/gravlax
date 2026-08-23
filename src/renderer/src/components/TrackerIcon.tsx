import type { JSX } from 'solid-js'
import type { UploadTrackerId } from '@shared/types'
import { UPLOAD_TRACKER_IDS, trackerName } from '@shared/trackers'
import redactedIcon from '../assets/trackers/redacted.png'
import orpheusIcon from '../assets/trackers/orpheus.png'

const ICONS: Record<UploadTrackerId, string> = {
  redacted: redactedIcon,
  orpheus: orpheusIcon
}

export function trackerLabel(id: UploadTrackerId): string {
  return trackerName(id)
}

export function trackerIdFromFieldName(fieldName: string): UploadTrackerId | null {
  return UPLOAD_TRACKER_IDS.find((id) => fieldName.startsWith(`${id}.`)) ?? null
}

export function TrackerIcon(props: {
  trackerId: UploadTrackerId
  size?: number
  class?: string
  alt?: string
}): JSX.Element {
  const size = () => props.size ?? 16
  return (
    <img
      class={`tracker-icon ${props.class ?? ''}`.trim()}
      src={ICONS[props.trackerId]}
      width={size()}
      height={size()}
      alt={props.alt ?? trackerName(props.trackerId)}
      draggable={false}
    />
  )
}
