import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { HealthResult, HealthRow, HealthStatus } from '@shared/types'
import { isEditableTarget } from '../keybinds'
import { Badge, Button, Callout, Card, EmptyState, Icon, Spinner, type BadgeTone, type IconName } from '../ui'

export function HealthcheckScreen(props: {
  result: HealthResult | null
  loading: boolean
  onRefresh: () => void
}) {
  const [expanded, setExpanded] = createSignal<Set<string>>(new Set())
  const [checkedAt, setCheckedAt] = createSignal<Date | null>(null)

  createEffect(() => {
    if (props.result && !props.loading) setCheckedAt(new Date())
  })

  createEffect(() => {
    const result = props.result
    if (!result || props.loading) return
    setExpanded(new Set(result.rows.filter(isFailedCheck).map((row) => row.id)))
  })

  onMount(() => {
    if (!props.result) props.onRefresh()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() !== 'r') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      props.onRefresh()
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  const groups = createMemo(() => {
    const rows = props.result?.rows ?? []
    const map = new Map<string, HealthRow[]>()
    for (const row of rows) {
      const key = row.group || 'Other'
      const list = map.get(key) ?? []
      list.push(row)
      map.set(key, list)
    }
    return [...map.entries()]
  })

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)' }}>
      <div class="content-frame">
        <div
          style={{
            display: 'flex',
            'justify-content': 'space-between',
            'align-items': 'flex-start',
            'margin-bottom': 'var(--space-5)',
            gap: '12px'
          }}
        >
          <div>
            <div style={{ 'font-weight': 700, 'font-size': 'var(--text-xl)' }}>Healthchecks</div>
            <div style={{ color: 'var(--fg-secondary)', 'margin-top': '4px' }}>
              {props.result?.overview ?? 'Checking dependencies…'}
            </div>
            <Show when={checkedAt()}>
              {(at) => (
                <div style={{ color: 'var(--fg-muted)', 'font-size': 'var(--text-sm)', 'margin-top': '6px' }}>
                  Last checked {at().toLocaleTimeString()}
                </div>
              )}
            </Show>
          </div>
          <Button variant="secondary" loading={props.loading} onClick={() => props.onRefresh()}>
            <Show when={!props.loading}>
              <Icon name="refresh-cw" size={14} />
            </Show>
            Refresh
          </Button>
        </div>

        <Show
          when={props.result}
          fallback={
            <div style={{ display: 'flex', 'justify-content': 'center', padding: 'var(--space-8)' }}>
              <Spinner size="lg" />
            </div>
          }
        >
          <Show
            when={(props.result?.rows.length ?? 0) > 0}
            fallback={<EmptyState icon="activity" title="No health checks" description="Nothing to report." />}
          >
            <For each={groups()}>
              {([group, rows]) => (
                <div style={{ 'margin-bottom': 'var(--space-5)' }}>
                  <div
                    style={{
                      'font-weight': 600,
                      'font-size': 'var(--text-sm)',
                      color: 'var(--accent)',
                      'margin-bottom': 'var(--space-2)',
                      'text-transform': 'uppercase',
                      'letter-spacing': '0.04em'
                    }}
                  >
                    {group}
                  </div>
                  <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                    <For each={rows}>
                      {(row) => (
                        <Card>
                          <button
                            type="button"
                            onClick={() => {
                              if (isFailedCheck(row)) {
                                setExpanded((ids) => {
                                  const next = new Set(ids)
                                  if (next.has(row.id)) next.delete(row.id)
                                  else next.add(row.id)
                                  return next
                                })
                              }
                            }}
                            style={{
                              width: '100%',
                              display: 'flex',
                              'align-items': 'center',
                              gap: '12px',
                              background: 'transparent',
                              border: 'none',
                              padding: 0,
                              'text-align': 'left',
                              cursor: isFailedCheck(row) ? 'pointer' : 'default'
                            }}
                          >
                            <span
                              style={{
                                display: 'flex',
                                color: statusColor(row),
                                'flex-shrink': 0
                              }}
                            >
                              <Icon name={statusIcon(row.status)} size={16} />
                            </span>
                            <div style={{ flex: 1, 'min-width': 0 }}>
                              <div style={{ 'font-weight': 600 }}>{row.name}</div>
                              <div
                                style={{
                                  color: 'var(--fg-secondary)',
                                  'font-size': 'var(--text-sm)',
                                  'margin-top': '2px'
                                }}
                              >
                                {row.detail ?? row.status}
                              </div>
                            </div>
                            <Badge tone={statusTone(row)}>{row.status}</Badge>
                          </button>
                          <Show when={expanded().has(row.id)}>
                            <Callout tone="info" class="health-install">
                              <Icon name="info" size={16} />
                              <div>
                                <div>{row.installInstructions ?? row.detail ?? row.status}</div>
                                <Show when={row.installURL}>
                                  {(url) => (
                                    <button
                                      type="button"
                                      class="mono health-install-link"
                                      onClick={() => void window.gravlax.shell.openExternal(url())}
                                    >
                                      {url()}
                                      <Icon name="external-link" size={14} />
                                    </button>
                                  )}
                                </Show>
                              </div>
                            </Callout>
                          </Show>
                        </Card>
                      )}
                    </For>
                  </div>
                </div>
              )}
            </For>
          </Show>
        </Show>
      </div>
    </div>
  )
}

function isFailedCheck(row: HealthRow): boolean {
  return row.status === 'failing' || row.status === 'missing'
}

function statusColor(row: HealthRow): string {
  switch (row.status) {
    case 'available':
      return 'var(--success)'
    case 'failing':
      return 'var(--error)'
    case 'missing':
      return row.detail?.includes('(optional)') ? 'var(--warning)' : 'var(--error)'
    case 'disabled':
      return 'var(--fg-muted)'
    default:
      return 'var(--fg-secondary)'
  }
}

function statusTone(row: HealthRow): BadgeTone {
  switch (row.status) {
    case 'available':
      return 'success'
    case 'failing':
      return 'error'
    case 'missing':
      return row.detail?.includes('(optional)') ? 'warning' : 'error'
    case 'disabled':
      return 'neutral'
    default:
      return 'info'
  }
}

function statusIcon(status: HealthStatus): IconName {
  switch (status) {
    case 'available':
      return 'check'
    case 'failing':
      return 'x'
    case 'missing':
      return 'alert-triangle'
    case 'disabled':
      return 'info'
    default:
      return 'activity'
  }
}
