import type { BbcodePreviewLoader } from './bbcodePreviewBatcher'

export interface BbcodePreviewState {
  html: string
  loading: boolean
  error: string | null
}

/** Each editor caches its preview; all editors use the same batched loader. */
export function createBbcodePreview(
  load: BbcodePreviewLoader,
  onChange: (state: BbcodePreviewState) => void
) {
  let started = false
  let disposed = false
  let generation = 0
  let pendingSource: string | null = null
  let lastSource: string | null = null
  let lastHtml = ''

  const request = (source: string, force = false): void => {
    if (disposed || (!force && pendingSource === source)) return
    started = true
    const current = ++generation
    pendingSource = null
    if (!force && lastSource === source) {
      onChange({ html: lastHtml, loading: false, error: null })
      return
    }
    if (!source) {
      lastSource = source
      lastHtml = ''
      onChange({ html: '', loading: false, error: null })
      return
    }
    pendingSource = source
    onChange({ html: lastHtml, loading: true, error: null })
    void load(source).then(
      (html) => {
        if (disposed || current !== generation) return
        pendingSource = null
        lastSource = source
        lastHtml = html
        onChange({ html, loading: false, error: null })
      },
      (error: unknown) => {
        if (disposed || current !== generation) return
        pendingSource = null
        const message = error instanceof Error ? error.message.trim() : String(error).trim()
        onChange({
          html: lastHtml,
          loading: false,
          error: message || 'Could not load the BBCode preview.'
        })
      }
    )
  }

  return {
    update(source: string, editing: boolean, ready: boolean): void {
      // Preload once with the other descriptions, even for an open editor.
      // Further typing waits until the user chooses Show preview.
      if (ready && (!editing || !started)) request(source)
    },
    retry(source: string): void {
      request(source, true)
    },
    dispose(): void {
      disposed = true
      generation += 1
    }
  }
}
