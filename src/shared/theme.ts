export type ThemePreference =
  | 'system'
  | 'dark'
  | 'midnight'
  | 'fjord'
  | 'ember'
  | 'phosphor'
  | 'light'
  | 'inkwell'
export type ResolvedTheme = Exclude<ThemePreference, 'system'>

export function resolveTheme(
  preference: ThemePreference | string | undefined,
  systemPrefersDark: boolean
): ResolvedTheme {
  if (preference === 'light') return 'light'
  if (preference === 'dark') return 'dark'
  if (preference === 'midnight') return 'midnight'
  if (preference === 'fjord') return 'fjord'
  if (preference === 'ember') return 'ember'
  if (preference === 'phosphor') return 'phosphor'
  if (preference === 'inkwell') return 'inkwell'
  return systemPrefersDark ? 'dark' : 'light'
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return (
    value === 'system' ||
    value === 'dark' ||
    value === 'midnight' ||
    value === 'fjord' ||
    value === 'ember' ||
    value === 'phosphor' ||
    value === 'light' ||
    value === 'inkwell'
  )
}

export function isLightTheme(theme: ResolvedTheme): boolean {
  return theme === 'light' || theme === 'inkwell'
}
