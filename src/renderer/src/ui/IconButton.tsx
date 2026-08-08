import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'
import { Icon, type IconName } from './Icon'

export function IconButton(
  props: {
    icon: IconName
    label: string
    size?: 'sm' | 'md'
  } & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
) {
  const [local, rest] = splitProps(props, ['icon', 'label', 'size', 'class'])
  const size = () => local.size ?? 'md'
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      aria-label={local.label}
      title={rest.title ?? local.label}
      class={`ui-icon-btn ${size() === 'sm' ? 'ui-icon-btn-sm' : ''} ${local.class ?? ''}`}
    >
      <Icon name={local.icon} size={size() === 'sm' ? 14 : 16} />
    </button>
  )
}
