import { createSignal } from 'solid-js'

/**
 * Holds a field's text locally while it has focus, so late state echoes from the main
 * process can't overwrite what the user is typing (or move the cursor to the end).
 */
export function createFocusBuffer(source: () => string, onChange: (value: string) => void) {
  const [local, setLocal] = createSignal<string | null>(null)
  return {
    value: () => local() ?? source(),
    focus: (value: string) => setLocal(value),
    input: (value: string) => {
      setLocal(value)
      onChange(value)
    },
    blur: () => {
      const value = local()
      setLocal(null)
      if (value !== null && value !== source()) onChange(value)
    }
  }
}
