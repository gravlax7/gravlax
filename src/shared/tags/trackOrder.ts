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

export interface TrackNumberTags {
  discNumber?: string
  trackNumber?: string
  trackTotal?: string
  discTotal?: string
}

/** The total from its own tag, or from the "3/13" form of the number tag. */
function statedTotal(total: string | undefined, number: string | undefined): number | undefined {
  return positiveNumber(total) ?? positiveNumber(/^\s*\d+\s*\/\s*(\d+)\s*$/.exec(number ?? '')?.[1])
}

/** "3", "3 and 5", "12–14": a sorted list of numbers in short form. */
function numberRanges(numbers: number[]): string {
  const ranges: string[] = []
  for (let i = 0; i < numbers.length; i++) {
    let end = i
    while (numbers[end + 1] === numbers[end]! + 1) end++
    ranges.push(end > i ? `${numbers[i]}–${numbers[end]}` : String(numbers[i]))
    i = end
  }
  return ranges.length > 1 ? `${ranges.slice(0, -1).join(', ')} and ${ranges.at(-1)}` : ranges[0]!
}

/** "Track 3 is" or "Tracks 12–14 are". */
function numbered(noun: string, numbers: number[]): string {
  const many = numbers.length > 1
  return `${noun}${many ? 's' : ''} ${numberRanges(numbers)} ${many ? 'are' : 'is'}`
}

function missingNumbers(present: Iterable<number>, highest: number): number[] {
  const seen = new Set(present)
  return Array.from({ length: highest }, (_, i) => i + 1).filter((n) => !seen.has(n))
}

/** One total for a set of files; undefined when no file states one. */
function agreedTotal(
  totals: (number | undefined)[],
  what: string,
  issues: string[],
  prefix = ''
): number | undefined {
  const stated = [...new Set(totals.filter((total) => total !== undefined))].sort((a, b) => a - b)
  if (stated.length > 1) issues.push(`${prefix}Files disagree on the ${what} total (${stated.join(', ')}).`)
  return stated.length === 1 ? stated[0] : undefined
}

/** Signs that tracks or discs are missing, read from the source tags. */
export function trackCompletenessNotices(files: readonly TrackNumberTags[]): string[] {
  const positions = numericTrackPositions(files)
  if (!positions) return []
  const issues: string[] = []
  const discs = [...new Set(positions.map((position) => position.disc))].sort((a, b) => a - b)
  const multiDisc = discs.length > 1 || discs[0] !== 1
  const lostDiscs = missingNumbers(discs, discs.at(-1)!)
  if (lostDiscs.length > 0) issues.push(`${numbered('Disc', lostDiscs)} missing.`)
  const discTotals = files.map((file) => statedTotal(file.discTotal, file.discNumber))
  const discTotal = agreedTotal(discTotals, 'disc', issues)
  if (discTotal !== undefined && discTotal > discs.at(-1)!) {
    issues.push(`Tags say ${discTotal} discs; the folder has ${discs.length}.`)
  }
  for (const disc of discs) {
    const prefix = multiDisc ? `Disc ${disc}: ` : ''
    const onDisc = files.filter((_, index) => positions[index]!.disc === disc)
    const numbers = positions.filter((position) => position.disc === disc).map((position) => position.track)
    const highest = Math.max(...numbers)
    const lost = missingNumbers(numbers, highest)
    if (lost.length > 0) issues.push(`${prefix}${numbered('Track', lost)} missing.`)
    const totals = onDisc.map((file) => statedTotal(file.trackTotal, file.trackNumber))
    const total = agreedTotal(totals, 'track', issues, prefix)
    if (total === undefined) continue
    const past = numbers.filter((n) => n > total).sort((a, b) => a - b)
    if (past.length > 0) issues.push(`${prefix}${numbered('Track', past)} numbered past the total of ${total}.`)
    if (total !== numbers.length) {
      issues.push(`${prefix}Tags say ${total} tracks; the ${multiDisc ? 'disc' : 'folder'} has ${numbers.length}.`)
    }
  }
  return issues
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
