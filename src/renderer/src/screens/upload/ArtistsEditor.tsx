import { Index } from 'solid-js'
import type { Artist } from '@shared/types'
import {
  ARTIST_ROLE_PRESETS,
  DEFAULT_ARTIST_ROLE
} from '@shared/types/upload'
import {
  artistHasMainRole,
  artistRoleLabel,
  normalizeArtistRole
} from '@shared/tags/editor'
import { Select } from '../../components/Select'

const ROLE_OPTIONS = [...ARTIST_ROLE_PRESETS]

export type ArtistEditAction =
  | { type: 'name'; index: number; name: string }
  | { type: 'role'; index: number; role: string }
  | { type: 'remove'; index: number }
  | { type: 'add' }

export function ArtistsEditor(props: {
  artists: Artist[]
  onEdit: (action: ArtistEditAction) => void
  onCommit?: () => void
  onFieldBlur?: () => void
  autoFocus?: boolean
}) {
  const updateRole = (index: number, role: string): void => {
    const nextRole = normalizeArtistRole(role)
    const current = props.artists[index]
    if (
      current &&
      artistHasMainRole(current) &&
      nextRole !== DEFAULT_ARTIST_ROLE &&
      props.artists.filter(artistHasMainRole).length <= 1
    ) {
      return
    }
    props.onEdit({ type: 'role', index, role: nextRole })
  }

  const removeAt = (index: number): void => {
    const current = props.artists[index]
    if (!current) return
    if (artistHasMainRole(current) && props.artists.filter(artistHasMainRole).length <= 1) {
      return
    }
    props.onEdit({ type: 'remove', index })
  }

  const addArtist = (): void => {
    props.onEdit({ type: 'add' })
  }

  const canRemove = (index: number): boolean => {
    const current = props.artists[index]
    if (!current) return false
    if (!artistHasMainRole(current)) return true
    return props.artists.filter(artistHasMainRole).length > 1
  }

  return (
    <div
      style={{ display: 'flex', 'flex-direction': 'column', gap: '6px' }}
      onFocusOut={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          props.onFieldBlur?.()
        }
      }}
    >
      <Index each={props.artists}>
        {(artist, index) => (
          <div style={{ display: 'flex', gap: '6px', 'align-items': 'center' }}>
            <input
              class="mono"
              ref={(el) => {
                if ((props.autoFocus ?? true) && index === 0) {
                  queueMicrotask(() => {
                    el.focus()
                    el.select()
                  })
                }
              }}
              value={artist().name ?? ''}
              placeholder="Artist"
              onInput={(event) => props.onEdit({
                type: 'name',
                index,
                name: event.currentTarget.value
              })}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  props.onCommit?.()
                }
              }}
              style={{
                flex: 1,
                'min-width': 0,
                margin: 0,
                padding: '4px 8px'
              }}
            />
            <Select
              value={normalizeArtistRole(artist().role ?? '')}
              options={ROLE_OPTIONS}
              labelFor={artistRoleLabel}
              onChange={(role) => updateRole(index, role)}
              style={{ 'min-width': '0', width: '150px', display: 'block', flex: '0 0 150px' }}
            />
            <button
              type="button"
              aria-label="Remove artist"
              disabled={!canRemove(index)}
              onClick={() => removeAt(index)}
              style={{
                flex: '0 0 auto',
                width: '32px',
                padding: '4px 0',
                'line-height': 1
              }}
            >
              −
            </button>
          </div>
        )}
      </Index>
      <button
        type="button"
        aria-label="Add artist"
        onClick={addArtist}
        style={{
          'align-self': 'flex-start',
          width: '32px',
          padding: '4px 0',
          'line-height': 1
        }}
      >
        +
      </button>
    </div>
  )
}
