import { describe, expect, it } from 'vitest'
import { isLightTheme, isThemePreference, resolveTheme } from '../theme'

describe('resolveTheme', () => {
  it('returns light when preference is light', () => {
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('light', false)).toBe('light')
  })

  it('returns dark when preference is dark', () => {
    expect(resolveTheme('dark', true)).toBe('dark')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('returns midnight when preference is midnight', () => {
    expect(resolveTheme('midnight', true)).toBe('midnight')
    expect(resolveTheme('midnight', false)).toBe('midnight')
  })

  it.each(['fjord', 'ember', 'phosphor', 'inkwell'] as const)(
    'returns %s regardless of the system setting',
    (theme) => {
      expect(resolveTheme(theme, true)).toBe(theme)
      expect(resolveTheme(theme, false)).toBe(theme)
    }
  )

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
    expect(isThemePreference('midnight')).toBe(true)
    expect(isThemePreference('fjord')).toBe(true)
    expect(isThemePreference('ember')).toBe(true)
    expect(isThemePreference('phosphor')).toBe(true)
    expect(isThemePreference('light')).toBe(true)
    expect(isThemePreference('inkwell')).toBe(true)
  })

  it('rejects invalid values', () => {
    expect(isThemePreference('auto')).toBe(false)
    expect(isThemePreference('aurora')).toBe(false)
    expect(isThemePreference('plum')).toBe(false)
    expect(isThemePreference(null)).toBe(false)
  })
})

describe('isLightTheme', () => {
  it('treats light and inkwell as light themes', () => {
    expect(isLightTheme('light')).toBe(true)
    expect(isLightTheme('inkwell')).toBe(true)
  })

  it('treats the rest as dark themes', () => {
    for (const theme of ['dark', 'midnight', 'fjord', 'ember', 'phosphor'] as const) {
      expect(isLightTheme(theme)).toBe(false)
    }
  })
})
