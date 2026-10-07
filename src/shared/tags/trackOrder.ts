import type { Track } from '@shared/types'

export const TRACK_ORDER_FALLBACK_NOTICE =
  'Using filename order because disc or track number tags are missing, invalid, or duplicated. Check the proposed track changes.'

/** True when `paths` names each of `expected` exactly once, in any order. */
export function sameTrackPaths(paths: readonly string[], expected: readonly string[]): boolean {
  const known = new Set(expected)
  return paths.length === known.size && new Set(paths).size === paths.length &&
    paths.every((path) => known.has(path))
}

interface TrackPosition {
  disc: number
  track: number
}

function positiveNumber(value: string | undefined): number | undefined {
  const text = value?.trim() ?? ''
  if (!/^\d+(?:\s*\/\s*\d+)?$/.test(text)) return undefined
  const number = Number(text.split('/')[0]!.trim())
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}

/** Undefined means the whole release must keep its filename order. */
export function numericTrackPositions(tracks: readonly Track[]): TrackPosition[] | undefined {
  if (tracks.length === 0) return undefined
  const discs = tracks.map((track) =>
    track.discNumber?.trim() ? positiveNumber(track.discNumber) : undefined
  )
  const multiDisc = discs.some((disc) => disc !== undefined && disc > 1)
  const seen = new Set<string>()
  const positions: TrackPosition[] = []
  for (const [index, track] of tracks.entries()) {
    const missingDisc = !track.discNumber?.trim()
    if (missingDisc && multiDisc) return undefined
    const disc = missingDisc ? 1 : discs[index]
    const number = positiveNumber(track.trackNumber)
    if (disc === undefined || number === undefined) return undefined
    const key = `${disc}:${number}`
    if (seen.has(key)) return undefined
    seen.add(key)
    positions.push({ disc, track: number })
  }
  return positions
}

export function trackPositionMismatchNotice(
  current: readonly Track[],
  selected: readonly Track[]
): string | undefined {
  const local = numericTrackPositions(current)
  const fetched = numericTrackPositions(selected)
  if (!local || !fetched || local.length !== fetched.length) return undefined
  return local.some((position, index) =>
    position.disc !== fetched[index]!.disc || position.track !== fetched[index]!.track
  )
    ? 'Existing disc and track numbers differ from the selected metadata. Tracks are paired in order; check the proposed track changes.'
    : undefined
}
