import { createEffect, createRoot, createSignal, flush } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { createFocusBuffer } from '../focusBuffer'

// Acts like a DOM input: writing a different value moves the cursor to the end.
function fakeInput(initial: string) {
  let text = initial
  const el = {
    selectionStart: initial.length,
    selectionEnd: initial.length,
    get value() {
      return text
    },
    set value(next: string) {
      if (next === text) return
      text = next
      el.selectionStart = el.selectionEnd = next.length
    }
  }
  return el
}

describe('createFocusBuffer', () => {
  it('keeps the edited text and cursor when stale state arrives during rapid input', () => {
    const sent: string[] = []
    const el = fakeInput('Hello world')
    const { setState, buffer, dispose } = createRoot((dispose) => {
      const [state, setState] = createSignal('Hello world')
      const buffer = createFocusBuffer(state, (value) => sent.push(value))
      createEffect(
        () => buffer.value(),
        (value) => {
          el.value = value
        }
      )
      return { setState, buffer, dispose }
    })
    flush()

    buffer.focus(el.value)
    flush()

    // Backspace twice after "Hello"; the user's edit keeps the cursor where it was.
    let cursor = 5
    for (const next of ['Hell world', 'Hel world']) {
      cursor -= 1
      el.value = next
      el.selectionStart = el.selectionEnd = cursor
      buffer.input(el.value)
      flush()
    }
    // State echoes arrive late and out of order.
    setState('Hell world')
    flush()
    setState('Hello world')
    flush()

    expect(el.value).toBe('Hel world')
    expect([el.selectionStart, el.selectionEnd]).toEqual([3, 3])
    expect(sent).toEqual(['Hell world', 'Hel world'])

    buffer.blur()
    flush()
    expect(sent).toEqual(['Hell world', 'Hel world', 'Hel world'])
    setState('Hel world')
    flush()
    expect(el.value).toBe('Hel world')
    dispose()
  })

  it('follows state when not focused', () => {
    const { setState, buffer, dispose } = createRoot((dispose) => {
      const [state, setState] = createSignal('a')
      return { setState, buffer: createFocusBuffer(state, () => {}), dispose }
    })
    setState('b')
    flush()
    expect(buffer.value()).toBe('b')
    dispose()
  })
})
