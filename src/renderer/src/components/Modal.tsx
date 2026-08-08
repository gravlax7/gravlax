import { For, Show, createSignal, onCleanup, onMount } from 'solid-js'

export function Modal(props: {
  title: string
  description?: string
  options: string[]
  defaultIndex?: number
  destructiveIndex?: number
  onChoose: (index: number) => void
}) {
  const [index, setIndex] = createSignal(props.defaultIndex ?? 0)

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      event.stopPropagation()
      setIndex((i) => (i + 1) % props.options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      setIndex((i) => (i - 1 + props.options.length) % props.options.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      event.stopPropagation()
      props.onChoose(index())
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      props.onChoose(props.options.length - 1)
    }
  }

  onMount(() => {
    window.addEventListener('keydown', onKey, true)
    onCleanup(() => window.removeEventListener('keydown', onKey, true))
  })

  return (
    <div class="ui-modal-backdrop" role="presentation">
      <div class="ui-modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title" class="ui-modal-title">
          {props.title}
        </h2>
        <Show when={props.description}>
          {(desc) => <p class="ui-modal-desc">{desc()}</p>}
        </Show>
        <div class="ui-modal-options">
          <For each={props.options}>
            {(option, i) => (
              <button
                type="button"
                class={`ui-modal-option ${
                  props.destructiveIndex === i() ? 'ui-modal-option-danger' : ''
                }`}
                data-active={i() === index() ? 'true' : 'false'}
                onClick={() => props.onChoose(i())}
                onMouseEnter={() => setIndex(i())}
              >
                {option}
              </button>
            )}
          </For>
        </div>
      </div>
    </div>
  )
}
