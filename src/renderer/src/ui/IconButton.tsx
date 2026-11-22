import type { JSX } from '@solidjs/web'
import { omit } from 'solid-js'
import { Icon, type IconName } from './Icon'

export function IconButton(
  props: {
    icon: IconName
    label: string
    size?: 'sm' | 'md'
  } & Omit<JSX.ButtonHTMLAttributes<HTMLButtonElement>, 'children'>
) {
  const rest = omit(props, 'icon', 'label', 'size', 'class')
  const size = () => props.size ?? 'md'
  return (
    <button
      {...rest}
      type={rest.type ?? 'button'}
      aria-label={props.label}
      title={rest.title ?? props.label}
      class={['ui-icon-btn', { 'ui-icon-btn-sm': size() === 'sm' }, props.class]}
    >
      <Icon name={props.icon} size={size() === 'sm' ? 14 : 16} />
    </button>
  )
}
