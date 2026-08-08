import { For, Show } from 'solid-js'
import type { BackgroundTask } from '@shared/types'
import { ProgressBar, Spinner } from '../ui'

export function TaskWidget(props: {
  tasks: BackgroundTask[]
  onJump: (step: string) => void
}) {
  return (
    <Show when={props.tasks.length > 0}>
      <div
        class="app-no-drag"
        style={{
          'border-top': '1px solid var(--border)',
          'background-color': 'var(--bg-surface)',
          padding: '8px 12px',
          display: 'flex',
          'flex-direction': 'column',
          gap: '6px'
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
                gap: '10px',
                width: '100%',
                padding: '6px 8px',
                background: 'var(--bg-raised)',
                border: '1px solid var(--border)',
                'border-radius': 'var(--radius-sm)',
                'text-align': 'left'
              }}
            >
              <Spinner size="sm" />
              <div style={{ flex: 1, 'min-width': 0 }}>
                <div
                  style={{
                    'font-size': 'var(--text-sm)',
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
