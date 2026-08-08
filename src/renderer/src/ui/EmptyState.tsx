import type { JSX } from 'solid-js'
import { Show } from 'solid-js'
import { Icon, type IconName } from './Icon'

export function EmptyState(props: {
  icon?: IconName
  title: string
  description?: string
  action?: JSX.Element
  class?: string
}) {
  return (
    <div class={`ui-empty ${props.class ?? ''}`}>
      <Show when={props.icon}>
        {(icon) => (
          <div class="ui-empty-icon">
            <Icon name={icon()} size={22} />
          </div>
        )}
      </Show>
      <h3 class="ui-empty-title">{props.title}</h3>
      <Show when={props.description}>
        {(desc) => <p class="ui-empty-desc">{desc()}</p>}
      </Show>
      <Show when={props.action}>{(action) => action()}</Show>
    </div>
  )
}
