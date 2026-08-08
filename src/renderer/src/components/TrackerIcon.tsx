import type { JSX } from 'solid-js'
import type { UploadTrackerId } from '@shared/types'
import redactedIcon from '../assets/trackers/redacted.png'
import orpheusIcon from '../assets/trackers/orpheus.png'

const ICONS: Record<UploadTrackerId, string> = {
  redacted: redactedIcon,
  orpheus: orpheusIcon
}

const LABELS: Record<UploadTrackerId, string> = {
  redacted: 'Redacted',
  orpheus: 'Orpheus'
}

export function trackerLabel(id: UploadTrackerId): string {
  return LABELS[id]
}

export function trackerIdFromFieldName(fieldName: string): UploadTrackerId | null {
  if (fieldName.startsWith('redacted.')) return 'redacted'
  if (fieldName.startsWith('orpheus.')) return 'orpheus'
  return null
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
      alt={props.alt ?? LABELS[props.trackerId]}
      draggable={false}
    />
  )
}
