import type { Config } from '@shared/types/config'
import type {
  TrackerGroupDetail,
  TrackerGroupSearchSnapshot,
  TrackerGroupSuggestion,
  TrackerGroupTorrentSummary,
  UploadArtist,
  UploadSnapshot,
  UploadTrackerId
} from '@shared/types'
import {
  buildDupeSearchStrings,
  groupSearchFingerprint
} from '@shared/upload/dupeSearch'
import { enabledTrackerOptions } from '@shared/config/trackers'
import { createEnabledTrackers, type Tracker } from '@main/core/tools/trackers'
import { asArray, asRecord, compileArtists, decodeHtml } from '@main/core/tools/trackers/json'

export function emptyGroupSearch(): TrackerGroupSearchSnapshot {
  return {
    status: 'idle',
    queryStrings: [],
    trackerIds: [],
    results: []
  }
}

export function resolveGroupSearchTrackerIds(
  upload: UploadSnapshot,
  cfg: Config
): UploadTrackerId[] {
  const enabled = enabledTrackerOptions(cfg).filter(
    (id): id is UploadTrackerId => id === 'redacted' || id === 'orpheus'
  )
  const selected = (upload.selectedTrackerIds ?? []).filter(
    (id): id is UploadTrackerId => id === 'redacted' || id === 'orpheus'
  )
  const chosen = selected.length > 0 ? selected.filter((id) => enabled.includes(id)) : enabled
  return [...new Set(chosen)]
}

export interface GroupSearchRequest {
  trackerIds: UploadTrackerId[]
  queryStrings: string[]
  fingerprint: string
}

/**
 * What a group search is being asked to do, derived from the upload draft.
 * Callers need the fingerprint to decide whether a search is worth repeating,
 * so this is deliberately separate from running one — but it is the only place
 * the three are computed.
 */
export function groupSearchRequest(upload: UploadSnapshot, cfg: Config): GroupSearchRequest {
  const trackerIds = resolveGroupSearchTrackerIds(upload, cfg)
  return {
    trackerIds,
    queryStrings: buildDupeSearchStrings({
      artists: upload.artists as UploadArtist[] | undefined,
      title: upload.title,
      catalogueNumber: upload.remasterCatalogueNumber
    }),
    fingerprint: groupSearchFingerprint({
      artists: upload.artists,
      title: upload.title,
      catalogueNumber: upload.remasterCatalogueNumber,
      trackerIds
    })
  }
}

export function suggestionKey(s: TrackerGroupSuggestion): string {
  return `${s.trackerId}:${s.groupId}`
}

export function mapBrowseResults(
  trackerId: UploadTrackerId,
  siteUrl: string,
  raw: unknown
): TrackerGroupSuggestion[] {
  const body = asRecord(raw)
  const results = asArray(body.results)
  const out: TrackerGroupSuggestion[] = []
  for (const item of results) {
    const group = asRecord(item)
    const groupId = Number(group.groupId)
    if (!Number.isFinite(groupId)) continue

    let artist = ''
    if (typeof group.artist === 'string' && group.artist.trim()) {
      artist = decodeHtml(group.artist)
    } else if (group.artists) {
      artist = decodeHtml(compileArtists(asArray(group.artists), Number(group.releaseType)))
    }

    const tags = asArray(group.tags)
      .map((t) => String(t).trim())
      .filter(Boolean)

    const year = typeof group.groupYear === 'number' ? group.groupYear : undefined
    const releaseType =
      group.releaseType === undefined || group.releaseType === null
        ? undefined
        : String(group.releaseType)

    out.push({
      trackerId,
      groupId,
      artist,
      groupName: decodeHtml(String(group.groupName ?? '')),
      year,
      releaseType,
      tags,
      url: `${siteUrl.replace(/\/+$/, '')}/torrents.php?id=${groupId}`
    })
  }
  return out
}

export function mapTorrentGroupDetail(
  trackerId: UploadTrackerId,
  siteUrl: string,
  groupId: number,
  raw: unknown
): TrackerGroupDetail {
  const body = asRecord(raw)
  const group = asRecord(body.group ?? body)
  const torrentsRaw = asArray(body.torrents ?? group.torrents ?? group.torrent)

  let artist = ''
  if (typeof group.musicInfo === 'object' && group.musicInfo) {
    const musicInfo = asRecord(group.musicInfo)
    const artists = asArray(musicInfo.artists)
    artist = decodeHtml(compileArtists(artists, Number(group.releaseType)))
  } else if (typeof group.artist === 'string') {
    artist = decodeHtml(group.artist)
  } else if (group.artists) {
    artist = decodeHtml(compileArtists(asArray(group.artists), Number(group.releaseType)))
  }

  const torrents: TrackerGroupTorrentSummary[] = torrentsRaw.map((t) => {
    const torrent = asRecord(t)
    return {
      media: typeof torrent.media === 'string' ? torrent.media : undefined,
      format: typeof torrent.format === 'string' ? torrent.format : undefined,
      encoding: typeof torrent.encoding === 'string' ? torrent.encoding : undefined,
      remasterYear:
        typeof torrent.remasterYear === 'number'
          ? torrent.remasterYear
          : typeof torrent.remasterYear === 'string'
            ? Number(torrent.remasterYear) || undefined
            : undefined,
      remasterTitle: typeof torrent.remasterTitle === 'string' ? torrent.remasterTitle : undefined,
      remasterRecordLabel:
        typeof torrent.remasterRecordLabel === 'string' ? torrent.remasterRecordLabel : undefined,
      remasterCatalogueNumber:
        typeof torrent.remasterCatalogueNumber === 'string'
          ? torrent.remasterCatalogueNumber
          : undefined,
      fileCount: typeof torrent.fileCount === 'number' ? torrent.fileCount : undefined,
      size: typeof torrent.size === 'number' ? torrent.size : undefined
    }
  })

  const year =
    typeof group.year === 'number'
      ? group.year
      : typeof group.groupYear === 'number'
        ? group.groupYear
        : undefined

  return {
    trackerId,
    groupId,
    artist,
    groupName: decodeHtml(String(group.name ?? group.groupName ?? '')),
    year,
    releaseType:
      group.releaseType === undefined || group.releaseType === null
        ? undefined
        : String(group.releaseType),
    url: `${siteUrl.replace(/\/+$/, '')}/torrents.php?id=${groupId}`,
    torrents
  }
}

export async function searchTrackerGroups(
  cfg: Config,
  request: GroupSearchRequest,
  signal?: AbortSignal
): Promise<TrackerGroupSearchSnapshot> {
  const { trackerIds, queryStrings, fingerprint } = request

  if (trackerIds.length === 0) {
    return {
      status: 'failed',
      queryStrings,
      trackerIds,
      fingerprint,
      results: [],
      error: 'No trackers enabled.',
      searchedAt: Date.now()
    }
  }

  if (queryStrings.length === 0) {
    return {
      status: 'done',
      queryStrings,
      trackerIds,
      fingerprint,
      results: [],
      searchedAt: Date.now()
    }
  }

  const trackers = createEnabledTrackers(cfg).filter((t) =>
    trackerIds.includes(t.id as UploadTrackerId)
  )
  const byKey = new Map<string, TrackerGroupSuggestion>()

  try {
    for (const tracker of trackers) {
      if (signal?.aborted) throw abortError()
      const suggestions = await browseTrackerGroups(tracker, queryStrings, signal)
      for (const suggestion of suggestions) {
        byKey.set(suggestionKey(suggestion), suggestion)
      }
    }

    return {
      status: 'done',
      queryStrings,
      trackerIds,
      fingerprint,
      results: [...byKey.values()],
      searchedAt: Date.now()
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err
    return {
      status: 'failed',
      queryStrings,
      trackerIds,
      fingerprint,
      results: [...byKey.values()],
      error: String((err as Error).message ?? err),
      searchedAt: Date.now()
    }
  }
}

async function browseTrackerGroups(
  tracker: Tracker,
  queryStrings: string[],
  signal?: AbortSignal
): Promise<TrackerGroupSuggestion[]> {
  const client = tracker.client
  const byKey = new Map<string, TrackerGroupSuggestion>()

  for (const searchstr of queryStrings) {
    if (signal?.aborted) throw abortError()
    const raw = await client.browse({ searchstr }, signal)
    for (const suggestion of mapBrowseResults(tracker.id as UploadTrackerId, client.siteUrl, raw)) {
      byKey.set(suggestionKey(suggestion), suggestion)
    }
  }

  return [...byKey.values()]
}

export async function fetchTorrentGroupDetail(
  cfg: Config,
  trackerId: UploadTrackerId,
  groupId: number,
  signal?: AbortSignal
): Promise<TrackerGroupDetail> {
  const tracker = createEnabledTrackers(cfg).find((t) => t.id === trackerId)
  if (!tracker) throw new Error(`Tracker ${trackerId} is not enabled.`)
  const raw = await tracker.client.torrentGroup(groupId, signal)
  return mapTorrentGroupDetail(trackerId, tracker.client.siteUrl, groupId, raw)
}

export async function resolveTorrentIdToGroupId(
  cfg: Config,
  trackerId: UploadTrackerId,
  torrentId: number,
  signal?: AbortSignal
): Promise<number | null> {
  const tracker = createEnabledTrackers(cfg).find((t) => t.id === trackerId)
  if (!tracker) throw new Error(`Tracker ${trackerId} is not enabled.`)
  return tracker.client.torrentGroupIdFromTorrentId(torrentId, signal)
}

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

