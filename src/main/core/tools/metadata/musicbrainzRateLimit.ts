export const MUSICBRAINZ_REQUEST_INTERVAL_MS = 1100
export const MUSICBRAINZ_BACKOFF_MS = 60_000

/** Keeps every MusicBrainz API request in this process below one call per second. */
export class MusicBrainzRateLimiter {
  private nextStartAt = 0
  private blockedUntil = 0
  private queue: Promise<void> = Promise.resolve()

  backOff(): void {
    this.blockedUntil = Math.max(this.blockedUntil, Date.now() + MUSICBRAINZ_BACKOFF_MS)
  }

  schedule<T>(request: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const run = async (): Promise<T> => {
      throwIfAborted(signal)
      if (this.blockedUntil > Date.now()) {
        throw new Error('MusicBrainz requests are paused after a rate-limit response')
      }

      const delayMs = Math.max(0, this.nextStartAt - Date.now())
      if (delayMs > 0) await abortableDelay(delayMs, signal)

      throwIfAborted(signal)
      if (this.blockedUntil > Date.now()) {
        throw new Error('MusicBrainz requests are paused after a rate-limit response')
      }
      this.nextStartAt = Date.now() + MUSICBRAINZ_REQUEST_INTERVAL_MS
      return request()
    }

    const result = this.queue.then(run, run)
    this.queue = result.then(
      () => undefined,
      () => undefined
    )
    return result
  }
}

export const sharedMusicBrainzRateLimiter = new MusicBrainzRateLimiter()

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms))

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    const onAbort = (): void => {
      clearTimeout(timer)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function abortError(): DOMException {
  return new DOMException('The operation was aborted', 'AbortError')
}
