import type { JSX } from '@solidjs/web'
import { omit } from 'solid-js'

export function Card(
  props: {
    selected?: boolean
    interactive?: boolean
    children?: JSX.Element
  } & JSX.HTMLAttributes<HTMLDivElement>
) {
  const rest = omit(props, 'selected', 'interactive', 'children', 'class')
  return (
    <div
      {...rest}
      class={[
        'ui-card',
        { 'ui-card-interactive': props.interactive, 'ui-card-selected': props.selected },
        props.class
      ]}
    >
      {props.children}
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
