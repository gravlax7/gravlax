export type ProcessProgress = {
  completed: number
  total: number
  currentLabel: string
}

export async function processFiles<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
  onProgress?: (progress: ProcessProgress) => void,
  labelOf?: (item: T) => string
): Promise<void> {
  if (items.length === 0) return
  const limit = Math.max(1, concurrency)
  let nextIndex = 0
  let completed = 0
  let firstError: unknown

  const runOne = async (): Promise<void> => {
    for (;;) {
      if (firstError) return
      const index = nextIndex++
      if (index >= items.length) return
      const item = items[index]!
      onProgress?.({
        completed,
        total: items.length,
        currentLabel: labelOf ? labelOf(item) : String(index + 1)
      })
      try {
        await worker(item, index)
      } catch (err) {
        firstError = err
        return
      }
      completed++
      onProgress?.({
        completed,
        total: items.length,
        currentLabel:
          completed < items.length && labelOf
            ? labelOf(items[completed]!)
            : ''
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runOne()))
  if (firstError) throw firstError
}
