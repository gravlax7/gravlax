import { describe, expect, it } from 'vitest'
import { isThemePreference, resolveTheme } from '../theme'

describe('resolveTheme', () => {
  it('returns light when preference is light', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('returns dark when preference is dark', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('follows system preference for system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })

  it('treats unknown preference as system', () => {
    expect(resolveTheme(undefined, true)).toBe('dark')
    expect(resolveTheme('weird', false)).toBe('light')
  })
})

describe('isThemePreference', () => {
  it('accepts valid values', () => {
    expect(isThemePreference('system')).toBe(true)
    expect(isThemePreference('dark')).toBe(true)
    expect(isThemePreference('light')).toBe(true)
  })

  it('rejects invalid values', () => {
    expect(isThemePreference('auto')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })
})
