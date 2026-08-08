import type { JSX } from 'solid-js'
import { splitProps } from 'solid-js'

export function Card(
  props: {
    selected?: boolean
    interactive?: boolean
    children?: JSX.Element
  } & JSX.HTMLAttributes<HTMLDivElement>
) {
  const [local, rest] = splitProps(props, ['selected', 'interactive', 'children', 'class'])
  return (
    <div
      {...rest}
      class={`ui-card ${local.interactive ? 'ui-card-interactive' : ''} ${
        local.selected ? 'ui-card-selected' : ''
      } ${local.class ?? ''}`}
    >
      {local.children}
    </div>
  )
}

export function Section(props: {
  title?: string
  description?: string
  children?: JSX.Element
  class?: string
}) {
  return (
    <section class={`ui-section ${props.class ?? ''}`}>
      {props.title ? <h2 class="ui-section-title">{props.title}</h2> : null}
      {props.description ? <p class="ui-section-desc">{props.description}</p> : null}
      {props.children}
    </section>
  )
}
