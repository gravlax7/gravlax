import type { HealthResult, UploadFlowStateJSON } from '@shared/types'
import { isLightTheme, type ResolvedTheme } from '@shared/theme'
import { UPLOAD_STEPS } from '@shared/upload/stepGating'
import { Icon, IconButton, type IconName } from '../ui'

export type HealthOverall = {
  label: string
  color: string
  icon: IconName
}

export function summarizeHealth(result: HealthResult | null, loading: boolean): HealthOverall {
  if (loading && !result) {
    return { label: 'Checking…', color: 'var(--fg-muted)', icon: 'activity' }
  }
  if (!result) {
    return { label: 'Health unknown', color: 'var(--fg-muted)', icon: 'activity' }
  }
  if (result.overview === 'Ready to upload.') {
    return { label: 'Ready', color: 'var(--success)', icon: 'check' }
  }
  const hasHardFailure = result.rows.some((row) => {
    if (row.status === 'failing') return true
    if (row.status === 'missing' && !row.detail?.includes('(optional)')) return true
    return false
  })
  if (hasHardFailure) {
    return { label: 'Not ready', color: 'var(--error)', icon: 'alert-triangle' }
  }
  return { label: 'Not ready', color: 'var(--warning)', icon: 'alert-triangle' }
}

export function StatusBar(props: {
  theme: ResolvedTheme
  onToggleTheme: () => void
  health: HealthOverall
  onOpenHealth: () => void
  uploadState?: UploadFlowStateJSON | null
  uploadCount: number
}) {
  const stepLabel = (): string | null => {
    const state = props.uploadState
    if (!state) return null
    if (!state.draft.sourcePath) return null
    const step = UPLOAD_STEPS.find((s) => s.index === state.currentStep)
    if (!step) return null
    const source = state.draft.sourcePath
    if (!source) return step.title
    const base = source.split(/[/\\]/).filter(Boolean).at(-1)
    return base ? `${step.title} · ${base}` : step.title
  }

  return (
    <footer
      class="app-no-drag status-bar"
      style={{
        'border-top': '1px solid var(--border)',
        'background-color': 'var(--bg-surface)',
        padding: '4px 10px',
        display: 'flex',
        gap: '12px',
        'font-size': 'var(--text-sm)',
        color: 'var(--fg-secondary)',
        'align-items': 'center',
        'min-height': '32px'
      }}
    >
      <button
        type="button"
        class="status-bar-item"
        onClick={props.onOpenHealth}
        title={props.health.label}
        style={{
          display: 'inline-flex',
          'align-items': 'center',
          gap: '6px',
          background: 'transparent',
          border: '1px solid transparent',
          'border-radius': 'var(--radius-sm)',
          padding: '2px 6px',
          color: 'var(--fg-secondary)',
          cursor: 'pointer',
          'font-size': 'var(--text-sm)'
        }}
      >
        <span style={{ display: 'flex', color: props.health.color }}>
          <Icon name={props.health.icon} size={14} />
        </span>
        <span>{props.health.label}</span>
      </button>

      <span
        title="Successful source and transcode uploads"
        style={{ color: 'var(--fg-secondary)', 'white-space': 'nowrap' }}
      >
        Uploads: {new Intl.NumberFormat().format(props.uploadCount)}
      </span>

      <span
        style={{
          flex: 1,
          'min-width': 0,
          overflow: 'hidden',
          'text-overflow': 'ellipsis',
          'white-space': 'nowrap',
          color: 'var(--fg-muted)'
        }}
        title={stepLabel() ?? undefined}
      >
        {stepLabel() ?? ''}
      </span>

      <IconButton
        icon={isLightTheme(props.theme) ? 'sun' : 'moon'}
        label={isLightTheme(props.theme) ? 'Switch to dark theme' : 'Switch to light theme'}
        size="sm"
        onClick={props.onToggleTheme}
      />
    </footer>
  )
}
