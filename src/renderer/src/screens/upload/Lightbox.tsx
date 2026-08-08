import { Show, createSignal, onCleanup, onMount } from 'solid-js'
import { Button, Icon, IconButton } from '../../ui'
import { spectralUrl } from './pathUtil'

export function Lightbox(props: {
  images: Array<{ src: string; label: string }>
  index: number
  onClose: () => void
  onChangeIndex: (index: number) => void
}) {
  const [zoomed, setZoomed] = createSignal(false)

  onMount(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        props.onClose()
        return
      }
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        props.onChangeIndex(Math.max(0, props.index - 1))
        return
      }
      if (event.key === 'ArrowRight') {
        event.preventDefault()
        props.onChangeIndex(Math.min(props.images.length - 1, props.index + 1))
      }
    }
    window.addEventListener('keydown', onKey, true)
    onCleanup(() => window.removeEventListener('keydown', onKey, true))
  })

  const current = () => props.images[props.index]

  return (
    <div
      class="ui-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={current()?.label ?? 'Image preview'}
      onClick={() => props.onClose()}
    >
      <div class="ui-lightbox-panel" onClick={(event) => event.stopPropagation()}>
        <div class="ui-lightbox-toolbar">
          <span class="ui-lightbox-caption mono">{current()?.label}</span>
          <div class="ui-lightbox-actions">
            <IconButton
              icon={zoomed() ? 'eye-off' : 'eye'}
              label={zoomed() ? 'Fit to view' : 'Zoom in'}
              size="sm"
              onClick={() => setZoomed((v) => !v)}
            />
            <IconButton icon="x" label="Close" size="sm" onClick={() => props.onClose()} />
          </div>
        </div>
        <div class="ui-lightbox-stage">
          <Show when={props.index > 0}>
            <IconButton
              class="ui-lightbox-nav ui-lightbox-nav-prev"
              icon="chevron-left"
              label="Previous"
              onClick={() => props.onChangeIndex(props.index - 1)}
            />
          </Show>
          <img
            class={`ui-lightbox-img ${zoomed() ? 'ui-lightbox-img-zoomed' : ''}`}
            src={spectralUrl(current()?.src ?? '')}
            alt={current()?.label ?? 'Spectral'}
          />
          <Show when={props.index < props.images.length - 1}>
            <IconButton
              class="ui-lightbox-nav ui-lightbox-nav-next"
              icon="chevron-right"
              label="Next"
              onClick={() => props.onChangeIndex(props.index + 1)}
            />
          </Show>
        </div>
        <div class="ui-lightbox-footer">
          <Button variant="ghost" size="sm" onClick={() => props.onClose()}>Close</Button>
        </div>
      </div>
    </div>
  )
}
