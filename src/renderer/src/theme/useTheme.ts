import { createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import type { ThemePreference } from '@shared/types/config'
import { resolveTheme, type ResolvedTheme } from '@shared/theme'

export function useTheme(preference: () => ThemePreference | undefined): () => ResolvedTheme {
  const [systemDark, setSystemDark] = createSignal(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true
  )
  const [resolved, setResolved] = createSignal<ResolvedTheme>('dark')

  onMount(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => {
      setSystemDark(mq.matches)
    }
    mq.addEventListener('change', onChange)
    onCleanup(() => mq.removeEventListener('change', onChange))
  })

  createEffect(() => {
    const next = resolveTheme(preference(), systemDark())
    setResolved(next)
    document.documentElement.dataset.theme = next
  })

  return resolved
}
