import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { UploadTrackerId } from '@shared/types'
import type { UploadStats } from '@shared/types/stats'

const UPLOAD_STATS_FILE = 'upload-stats.json'

export interface UploadStatsFile extends UploadStats {
  seenFormats: string[]
  seenSubmissions: string[]
}

export function emptyUploadStats(): UploadStatsFile {
  return {
    version: 1,
    formats: {},
    trackers: { redacted: 0, orpheus: 0 },
    seenFormats: [],
    seenSubmissions: []
  }
}

export function uploadStatsPath(userDataPath: string): string {
  return join(userDataPath, UPLOAD_STATS_FILE)
}

export function publicUploadStats(stats: UploadStatsFile): UploadStats {
  return {
    version: 1,
    formats: { ...stats.formats },
    trackers: { ...stats.trackers }
  }
}

export async function loadUploadStats(userDataPath: string): Promise<UploadStatsFile> {
  let payload: string
  try {
    payload = await readFile(uploadStatsPath(userDataPath), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return emptyUploadStats()
    throw err
  }

  try {
    return normalizeUploadStats(JSON.parse(payload))
  } catch {
    return emptyUploadStats()
  }
}

export async function saveUploadStats(userDataPath: string, stats: UploadStatsFile): Promise<void> {
  const target = uploadStatsPath(userDataPath)
  await mkdir(dirname(target), { recursive: true, mode: 0o755 })
  const temporary = `${target}.tmp`
  const payload = `${JSON.stringify(stats, null, 2)}\n`
  await writeFile(temporary, payload, { mode: 0o600 })
  await rename(temporary, target)
}

function normalizeUploadStats(raw: unknown): UploadStatsFile {
  const empty = emptyUploadStats()
  if (!raw || typeof raw !== 'object') return empty
  const value = raw as Record<string, unknown>
  if (value.version !== 1) return empty

  return {
    version: 1,
    formats: normalizeCounts(value.formats),
    trackers: {
      redacted: countFor(value.trackers, 'redacted'),
      orpheus: countFor(value.trackers, 'orpheus')
    },
    seenFormats: normalizeKeys(value.seenFormats),
    seenSubmissions: normalizeKeys(value.seenSubmissions)
  }
}

function normalizeCounts(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return Object.fromEntries(
    Object.entries(raw as Record<string, unknown>).filter(
      ([key, count]) => key.length > 0 && isCount(count)
    ) as Array<[string, number]>
  )
}

function countFor(raw: unknown, trackerId: UploadTrackerId): number {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 0
  const count = (raw as Record<string, unknown>)[trackerId]
  return isCount(count) ? count : 0
}

function normalizeKeys(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.filter((key): key is string => typeof key === 'string' && key.length > 0))]
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}
