import { For, Show } from 'solid-js'
import type { BackgroundTask } from '@shared/types'
import { ProgressBar, Spinner } from '../ui'

export function TaskWidget(props: {
  tasks: BackgroundTask[]
  onJump: (step: string) => void
  compact?: boolean
}) {
  return (
    <Show when={props.tasks.length > 0}>
      <div
        class="app-no-drag"
        style={{
          'border-top': props.compact ? '1px solid var(--border)' : 'none',
          'border-bottom': props.compact ? 'none' : '1px solid var(--border)',
          'background-color': 'var(--bg-surface)',
          padding: props.compact ? '6px 0' : '8px 12px',
          display: 'flex',
          'flex-direction': 'column',
          gap: props.compact ? '0' : '6px',
          'flex-shrink': 0,
          'max-height': props.compact ? '45%' : 'none',
          'overflow-y': props.compact ? 'auto' : 'visible'
        }}
      >
        <For each={props.tasks}>
          {(task) => (
            <button
              type="button"
              onClick={() => props.onJump(task.step)}
              style={{
                display: 'flex',
                'align-items': 'center',
                gap: props.compact ? '8px' : '10px',
                width: '100%',
                padding: props.compact ? '6px 12px' : '6px 8px',
                background: props.compact ? 'transparent' : 'var(--bg-raised)',
                border: props.compact ? 'none' : '1px solid var(--border)',
                'border-radius': props.compact ? '0' : 'var(--radius-sm)',
                'text-align': 'left'
              }}
            >
              <Spinner size="sm" />
              <div style={{ flex: 1, 'min-width': 0 }}>
                <div
                  style={{
                    'font-size': props.compact ? 'var(--text-xs)' : 'var(--text-sm)',
                    'font-weight': 600,
                    'white-space': 'nowrap',
                    overflow: 'hidden',
                    'text-overflow': 'ellipsis',
                    'margin-bottom': task.progressTotal > 0 ? '4px' : '0'
                  }}
                >
                  {task.title || task.id}
                </div>
                <Show when={task.progressTotal > 0}>
                  <ProgressBar
                    value={task.progressCurrent}
                    max={task.progressTotal}
                    label={task.progressLabel || task.title}
                  />
                </Show>
              </div>
            </button>
          )}
        </For>
      </div>
    </Show>
  )
}
