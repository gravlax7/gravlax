import { For } from 'solid-js'
import { formatKeybind } from '../keybinds'

export function Kbd(props: { keys: string[]; platform: NodeJS.Platform; class?: string }) {
  return (
    <span class={`ui-kbd ${props.class ?? ''}`}>{formatKeybind(props.keys, props.platform)}</span>
  )
}

export function SegmentedControl<T extends string>(props: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
  class?: string
  disabled?: boolean
}) {
  return (
    <div class={`ui-segmented ${props.class ?? ''}`} role="radiogroup">
      <For each={props.options}>
        {(option) => (
          <button
            type="button"
            role="radio"
            class="ui-segmented-item"
            aria-checked={props.value === option.value}
            disabled={props.disabled}
            onClick={() => props.onChange(option.value)}
          >
            {option.label}
          </button>
        )}
      </For>
    </div>
  )
}

export function Divider(props: { class?: string }) {
  return <hr class={`ui-divider ${props.class ?? ''}`} />
}

export function Skeleton(props: { width?: string; height?: string; class?: string }) {
  return (
    <div
      class={`ui-skeleton ${props.class ?? ''}`}
      style={{
        width: props.width ?? '100%',
        height: props.height ?? '16px'
      }}
    />
  )
}

export function Callout(props: {
  tone?: 'info' | 'warning' | 'error'
  children: import('solid-js').JSX.Element
  class?: string
}) {
  const tone = () => props.tone ?? 'info'
  return (
    <div class={`ui-callout ui-callout-${tone()} ${props.class ?? ''}`}>{props.children}</div>
  )
}
