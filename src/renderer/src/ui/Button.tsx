import type { JSX } from '@solidjs/web'
import { Show, omit } from 'solid-js'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export function Button(
  props: {
    variant?: ButtonVariant
    size?: ButtonSize
    loading?: boolean
    children?: JSX.Element
  } & JSX.ButtonHTMLAttributes<HTMLButtonElement>
) {
  const rest = omit(props, 'variant', 'size', 'loading', 'children', 'class', 'disabled')
  const variant = () => props.variant ?? 'secondary'
  const size = () => props.size ?? 'md'
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      disabled={props.disabled || props.loading}
      class={[`ui-btn ui-btn-${variant()} ui-btn-${size()}`, props.class]}
    >
      <Show when={props.loading}>
        <Spinner size="sm" />
      </Show>
      {props.children}
    </button>
  )
}
