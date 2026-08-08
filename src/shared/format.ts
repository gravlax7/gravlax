export function formatByteSize(size: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'] as const
  let value = size
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  if (unit === 0) {
    return `${size} ${units[unit]}`
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/** Empty when the rate is not yet known, so callers can leave the slot out. */
export function formatTransferRate(bytesPerSecond: number | undefined): string {
  if (!bytesPerSecond || bytesPerSecond <= 0) return ''
  return `${formatByteSize(Math.round(bytesPerSecond))}/s`
}

export function formatEta(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return ''
  const total = Math.round(seconds)
  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  if (minutes < 60) {
    const rest = total % 60
    return rest === 0 ? `${minutes}m` : `${minutes}m ${rest}s`
  }
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`
}

/** Seconds of transfer left, or undefined while the rate is still settling. */
export function etaSeconds(
  bytesTransferred: number | undefined,
  bytesTotal: number | undefined,
  bytesPerSecond: number | undefined
): number | undefined {
  if (!bytesTotal || !bytesPerSecond || bytesPerSecond <= 0) return undefined
  const remaining = bytesTotal - (bytesTransferred ?? 0)
  if (remaining <= 0) return 0
  return remaining / bytesPerSecond
}
