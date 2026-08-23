export const THEME_PREFERENCES = [
  'system',
  'dark',
  'midnight',
  'fjord',
  'ember',
  'phosphor',
  'light',
  'inkwell'
] as const

export type ThemePreference = (typeof THEME_PREFERENCES)[number]
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

export function resolveTheme(
  preference: ThemePreference | string | undefined,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (isThemePreference(preference) && preference !== 'system') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.some((theme) => theme === value)
}

export function isLightTheme(theme: ResolvedTheme): boolean {
  return theme === 'light' || theme === 'inkwell'
}
