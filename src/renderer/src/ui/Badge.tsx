import type { JSX } from 'solid-js'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'error' | 'info'

export function Badge(props: {
  tone?: BadgeTone
  children?: JSX.Element
  class?: string
}) {
  const tone = () => props.tone ?? 'neutral'
  return <span class={`ui-badge ui-badge-${tone()} ${props.class ?? ''}`}>{props.children}</span>
}

export function StatusDot(props: { color: string; title?: string; class?: string }) {
  return (
    <span
      class={`ui-status-dot ${props.class ?? ''}`}
      title={props.title}
      style={{ 'background-color': props.color }}
    />
  )
}
