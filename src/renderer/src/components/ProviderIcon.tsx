import { Show, type JSX } from 'solid-js'
import musicBrainzIcon from '../assets/providers/musicbrainz.png'
import deezerIcon from '../assets/providers/deezer.png'

const ICONS: Record<string, string> = {
  musicbrainz: musicBrainzIcon,
  deezer: deezerIcon
}

function key(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function hasProviderIcon(name: string): boolean {
  return key(name) in ICONS
}

/** `musicBrainz.enabled` -> `musicBrainz`, for settings fields. */
export function providerFromFieldName(fieldName: string): string | null {
  const prefix = fieldName.split('.')[0] ?? ''
  return hasProviderIcon(prefix) ? prefix : null
}

export function ProviderIcon(props: {
  provider: string
  size?: number
  class?: string
  alt?: string
}): JSX.Element {
  const src = () => ICONS[key(props.provider)]
  const size = () => props.size ?? 16
  return (
    <Show when={src()}>
      {(icon) => (
        <img
          class={`provider-icon ${props.class ?? ''}`.trim()}
          src={icon()}
          width={size()}
          height={size()}
          alt={props.alt ?? props.provider}
          draggable={false}
        />
      )}
    </Show>
  )
}
