import { createEffect, createMemo, createSignal, onSettled } from 'solid-js'
import type { ThemePreference } from '@shared/types/config'
import { resolveTheme, type ResolvedTheme } from '@shared/theme'

export function useTheme(preference: () => ThemePreference | undefined): () => ResolvedTheme {
  const [systemDark, setSystemDark] = createSignal(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true
  )

  onSettled(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      setSystemDark(mq.matches)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  })

  const resolved = createMemo(() => resolveTheme(preference(), systemDark()))

  createEffect(
    () => resolved(),
    (theme) => {
      document.documentElement.dataset.theme = theme
    }
  )

  return resolved
}
