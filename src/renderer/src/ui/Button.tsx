import type { JSX } from 'solid-js'
import { Show, splitProps } from 'solid-js'
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
  const [local, rest] = splitProps(props, [
    'variant',
    'size',
    'loading',
    'children',
    'class',
    'disabled'
  ])
  const variant = () => local.variant ?? 'secondary'
  const size = () => local.size ?? 'md'
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      disabled={local.disabled || local.loading}
      class={`ui-btn ui-btn-${variant()} ui-btn-${size()} ${local.class ?? ''}`}
    >
      <Show when={local.loading}>
        <Spinner size="sm" />
      </Show>
      {local.children}
    </button>
  )
}
