export type BbcodePreviewLoader = (source: string) => Promise<string>

interface PendingPreview {
  source: string
  resolve: (html: string) => void
  reject: (error: unknown) => void
}

export function createBbcodePreviewBatcher(
  load: BbcodePreviewLoader
): (source: string) => Promise<string> {
  let pending: PendingPreview[] = []
  let running = false

  const flush = async (): Promise<void> => {
    const batch = pending
    pending = []
    const marker = `GRAVLAXPREVIEWSPLIT${crypto.randomUUID().replaceAll('-', '')}`

    try {
      const html = await load(batch.map((item) => item.source).join(marker))
      const parts = batch.length === 1 ? [html] : html.split(marker)
      if (parts.length !== batch.length) throw new Error('Could not split the BBCode preview.')
      batch.forEach((item, index) => item.resolve(parts[index]!))
    } catch (error) {
      batch.forEach((item) => item.reject(error))
    }

    if (pending.length > 0) queueMicrotask(() => void flush())
    else running = false
  }

  return (source) =>
    new Promise<string>((resolve, reject) => {
      pending.push({ source, resolve, reject })
      if (running) return
      running = true
      queueMicrotask(() => void flush())
    })
}
