export function ProgressBar(props: {
  value: number
  max?: number
  tone?: 'default' | 'accent' | 'success'
  class?: string
  label?: string
}) {
  const max = () => Math.max(props.max ?? 100, 0)
  const pct = () => {
    if (max() <= 0) return 0
    return Math.min(100, Math.max(0, (props.value / max()) * 100))
  }
  const toneClass = () => {
    if (props.tone === 'accent') return 'ui-progress-accent'
    if (props.tone === 'success') return 'ui-progress-success'
    return ''
  }
  return (
    <div
      class={`ui-progress ${toneClass()} ${props.class ?? ''}`}
      role="progressbar"
      aria-valuenow={props.value}
      aria-valuemin={0}
      aria-valuemax={max()}
      aria-label={props.label}
    >
      <div class="ui-progress-bar" style={{ width: `${pct()}%` }} />
    </div>
  )
}
