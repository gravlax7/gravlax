/** Picks a one-based track id out of `count` tracks. Injected so tests can pin it. */
export type TrackPicker = (count: number) => number

const randomTrack: TrackPicker = (count) => Math.floor(Math.random() * count) + 1

function allTracks(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1)
}

/**
 * Which spectrals to host, from a settings string.
 *
 * The settings screen writes one of four names — `All`, `Random`, `First track`
 * or `None`. A hand-edited config may also hold `*` for every track, `0` for
 * none, or a list of one-based track numbers with optional ranges: `1,3,5-7`.
 * IDs outside the track range are dropped rather than treated as an error — the
 * setting is written once and reused across releases of different lengths.
 */
export function parseSpectralIds(
  spec: string | undefined,
  count: number,
  pick: TrackPicker = randomTrack
): number[] {
  const trimmed = (spec ?? '').trim()
  const name = trimmed.toLowerCase()
  if (trimmed === '' || trimmed === '0' || name === 'none') return []
  if (trimmed === '*' || name === 'all') return allTracks(count)
  if (name === 'first track') return count > 0 ? [1] : []
  if (name === 'random') {
    if (count === 0) return []
    const id = pick(count)
    return id >= 1 && id <= count ? [id] : [1]
  }

  const selected = new Set<number>()
  for (const part of trimmed.split(',')) {
    const token = part.trim()
    if (token === '') continue

    const range = token.match(/^(\d+)\s*-\s*(\d+)$/)
    if (range) {
      const start = Number.parseInt(range[1]!, 10)
      const end = Number.parseInt(range[2]!, 10)
      for (let id = Math.min(start, end); id <= Math.max(start, end); id++) {
        if (id >= 1 && id <= count) selected.add(id)
      }
      continue
    }

    const id = Number.parseInt(token, 10)
    if (Number.isFinite(id) && id >= 1 && id <= count) selected.add(id)
  }

  return [...selected].sort((a, b) => a - b)
}

/** The spectral selection for a release, honouring the lossy-master override. */
export function spectralIdsForRelease(
  options: { defaultSpectralIds: string; defaultSpectralIdsForLossyMasters: string },
  lossyMaster: boolean,
  count: number,
  pick: TrackPicker = randomTrack
): number[] {
  const spec = lossyMaster ? options.defaultSpectralIdsForLossyMasters : options.defaultSpectralIds
  return parseSpectralIds(spec, count, pick)
}

/** Add or drop one track, keeping the list sorted and free of duplicates. */
export function toggleSpectralId(ids: number[], id: number): number[] {
  const next = new Set(ids)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return [...next].sort((a, b) => a - b)
}

/** Drop ids no longer backed by a track, so a shorter release cannot host a ghost. */
export function clampSpectralIds(ids: number[], count: number): number[] {
  return [...new Set(ids.filter((id) => id >= 1 && id <= count))].sort((a, b) => a - b)
}
