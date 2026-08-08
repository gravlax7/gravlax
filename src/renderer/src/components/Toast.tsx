import { For, Show } from 'solid-js'
import type { NotifyPayload } from '@shared/types'
import { Icon, IconButton, type IconName } from '../ui'

export type ToastItem = NotifyPayload & { id: number }

function levelIcon(level: NotifyPayload['level']): IconName {
  switch (level) {
    case 'success':
      return 'check'
    case 'warning':
      return 'alert-triangle'
    case 'error':
      return 'x'
    default:
      return 'info'
  }
}

function levelColor(level: NotifyPayload['level']): string {
  switch (level) {
    case 'success':
      return 'var(--success)'
    case 'warning':
      return 'var(--warning)'
    case 'error':
      return 'var(--error)'
    default:
      return 'var(--info)'
  }
}

export function ToastStack(props: {
  items: ToastItem[]
  onDismiss: (id: number) => void
}) {
  return (
    <div class="ui-toast-stack" aria-live="polite" aria-relevant="additions">
      <For each={props.items}>
        {(item) => (
          <div class={`ui-toast ui-toast-${item.level}`} role="status">
            <span class="ui-toast-icon" style={{ color: levelColor(item.level) }}>
              <Icon name={levelIcon(item.level)} size={16} />
            </span>
            <div class="ui-toast-message">{item.message}</div>
            <IconButton icon="x" label="Dismiss" size="sm" onClick={() => props.onDismiss(item.id)} />
          </div>
        )}
      </For>
    </div>
  )
}

export function Toast(props: { payload: NotifyPayload; onDismiss: () => void }) {
  return (
    <Show when={props.payload}>
      <ToastStack
        items={[{ ...props.payload, id: 0 }]}
        onDismiss={() => props.onDismiss()}
      />
    </Show>
  )
}
