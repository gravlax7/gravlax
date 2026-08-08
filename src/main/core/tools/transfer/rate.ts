/** Roughly how much history the rate reflects. */
const WINDOW_MS = 3000

export interface RateMeter {
  /** Feed cumulative bytes; returns the smoothed rate, or 0 until it has two samples. */
  sample(bytesTransferred: number, now?: number): number
  bytesPerSecond(): number
}

/**
 * Exponentially weighted transfer rate.
 *
 * Lives in main rather than the renderer: state pushes are debounced, so
 * differencing successive snapshots on the UI side produces a number that
 * swings with the debounce rather than with the transfer.
 */
export function createRateMeter(windowMs = WINDOW_MS): RateMeter {
  let lastBytes: number | null = null
  let lastTime = 0
  let rate = 0

  return {
    sample(bytesTransferred: number, now = Date.now()): number {
      if (lastBytes === null) {
        lastBytes = bytesTransferred
        lastTime = now
        return 0
      }

      const elapsed = now - lastTime
      // Two callbacks in the same millisecond say nothing about throughput, and
      // dividing by the elapsed time would be a division by zero.
      if (elapsed <= 0) return rate

      const delta = bytesTransferred - lastBytes
      lastBytes = bytesTransferred
      lastTime = now

      const instant = (delta * 1000) / elapsed
      // Weight by elapsed time so a burst of fast callbacks does not count for
      // more than one slow one covering the same span.
      const alpha = 1 - Math.exp(-elapsed / windowMs)
      rate = rate === 0 ? instant : rate + alpha * (instant - rate)
      return rate
    },

    bytesPerSecond(): number {
      return rate
    }
  }
}
