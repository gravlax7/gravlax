import { describe, expect, it, vi } from 'vitest'
import { blurOnEnter } from '../keybinds'

function keyEvent(key: string, isComposing = false) {
  const blur = vi.fn()
  const event = { key, isComposing, currentTarget: { blur } } as unknown as Parameters<
    typeof blurOnEnter
  >[0]
  return { event, blur }
}

describe('blurOnEnter', () => {
  it('blurs the input on Enter', () => {
    const { event, blur } = keyEvent('Enter')
    expect(blurOnEnter(event)).toBe(true)
    expect(blur).toHaveBeenCalledOnce()
  })

  it('ignores other keys and Enter during IME composition', () => {
    for (const { event, blur } of [keyEvent('a'), keyEvent('Enter', true)]) {
      expect(blurOnEnter(event)).toBe(false)
      expect(blur).not.toHaveBeenCalled()
    }
  })
})
