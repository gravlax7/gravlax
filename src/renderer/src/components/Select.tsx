import { For, Show, createEffect, createSignal, onCleanup, type JSX } from 'solid-js'
import { Icon } from '../ui'

export function Select(props: {
  value: string
  options: string[]
  onChange: (value: string) => void
  labelFor?: (value: string) => string
  style?: JSX.CSSProperties
  class?: string
}) {
  const [open, setOpen] = createSignal(false)
  const [highlight, setHighlight] = createSignal(0)
  let root!: HTMLDivElement

  const label = (value: string): string => props.labelFor?.(value) ?? value

  const selectedIndex = (): number => {
    const idx = props.options.indexOf(props.value)
    return idx >= 0 ? idx : 0
  }

  createEffect(() => {
    if (open()) {
      setHighlight(selectedIndex())
    }
  })

  const close = (): void => {
    setOpen(false)
  }

  const choose = (value: string): void => {
    props.onChange(value)
    close()
  }

  const onDocPointer = (event: PointerEvent): void => {
    if (!open()) return
    if (root.contains(event.target as Node)) return
    close()
  }

  const onKey = (event: KeyboardEvent): void => {
    if (!open()) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        setOpen(true)
      }
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlight((i) => (i + 1) % props.options.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlight((i) => (i - 1 + props.options.length) % props.options.length)
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = props.options[highlight()]
      if (option != null) choose(option)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      close()
    }
  }

  createEffect(() => {
    if (!open()) return
    document.addEventListener('pointerdown', onDocPointer, true)
    onCleanup(() => document.removeEventListener('pointerdown', onDocPointer, true))
  })

  return (
    <div
      ref={root}
      class={`app-no-drag ${props.class ?? ''}`}
      style={{
        position: 'relative',
        display: 'inline-block',
        'min-width': '180px',
        ...props.style
      }}
    >
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={onKey}
        style={{
          display: 'flex',
          width: '100%',
          'align-items': 'center',
          'justify-content': 'space-between',
          gap: '12px',
          padding: '6px 10px',
          background: 'var(--bg-base)',
          color: 'var(--fg-primary)',
          border: open() ? '1px solid var(--border-focus)' : '1px solid var(--border)',
          'border-radius': 'var(--radius-sm)',
          'text-align': 'left'
        }}
      >
        <span>{label(props.value) || 'Select…'}</span>
        <Icon name="chevron-down" size={14} />
      </button>
      <Show when={open()}>
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            'z-index': 30,
            background: 'var(--bg-raised)',
            border: '1px solid var(--border)',
            'border-radius': 'var(--radius-md)',
            padding: '4px',
            'box-shadow': 'var(--shadow-md)',
            'max-height': '240px',
            overflow: 'auto'
          }}
        >
          <For each={props.options}>
            {(option, i) => {
              const active = (): boolean => i() === highlight()
              const selected = (): boolean => option === props.value
              return (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected()}
                  onMouseEnter={() => setHighlight(i())}
                  onClick={() => choose(option)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    'align-items': 'center',
                    gap: '8px',
                    padding: '7px 10px',
                    'text-align': 'left',
                    border: '1px solid transparent',
                    'border-radius': 'var(--radius-sm)',
                    background: active() ? 'var(--accent)' : 'transparent',
                    color: active() ? 'var(--accent-fg)' : 'var(--fg-primary)'
                  }}
                >
                  <span style={{ width: '14px', 'flex-shrink': 0, display: 'flex' }}>
                    <Show when={selected()}>
                      <Icon name="check" size={14} />
                    </Show>
                  </span>
                  <span>{label(option)}</span>
                </button>
              )
            }}
          </For>
        </div>
      </Show>
    </div>
  )
}
