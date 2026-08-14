import type { Config } from '@shared/types/config'
import type {
  BitDepth,
  Bitrate,
  Release,
  Track,
  TrackerGroupSearchSnapshot,
  UploadArtist,
  UploadFormatPayload,
  UploadSnapshot,
  UploadSubmission,
  UploadTrackerId
} from '@shared/types'
import { enabledTrackerOptions } from '@shared/config/trackers'
import { discoverLogFiles } from '@main/core/tools/diagnostics/sourceMedia'
import { discoverFLACFiles } from '@main/core/tools/flacFiles'
import { readFLACStreamInfo } from '@main/core/tools/diagnostics/mqa'
import {
  albumDescMetadataFromRelease,
  generateAlbumDescription,
  generateReleaseDescription,
  substituteSpectralBbcode,
  type TrackDescInput
} from '@main/core/tools/upload/descriptions'
import {
  generateConversionDescription,
  generateTranscodeDescription
} from '@main/core/tools/transcode'
import { downloadCoverIfNonexistent } from '@main/core/tools/upload/cover'
import { selectCoverImageHost, uploadCoverImage } from '@main/core/tools/imagehosts/upload'
import { artistRoleToImportance } from '@shared/upload/artists'
import { trackerEncoding } from '@shared/upload/encodings'
import { emptyGroupIds, allSelectedTrackersHaveGroupId } from '@shared/upload/groupIds'
import type { State } from './state'
import { emptyGroupSearch } from './groupSearch'

export function emptyUpload(): UploadSnapshot {
  return {
    phase: 'idle',
    selectedTrackerIds: [],
    artists: [],
    title: '',
    year: undefined,
    releaseType: '',
    orpheusSplit: false,
    unknown: false,
    remasterYear: undefined,
    remasterTitle: '',
    remasterRecordLabel: '',
    remasterCatalogueNumber: '',
    scene: false,
    media: '',
    tags: '',
    image: '',
    coverPath: '',
    albumDesc: '',
    groupIds: emptyGroupIds(),
    formats: [],
    groupSearch: emptyGroupSearch(),
    seededFrom: ''
  }
}

export function setUpload(s: State, snapshot: UploadSnapshot): State {
  return { ...s, upload: restoreUpload(snapshot) }
}

export function restoreUpload(snapshot: UploadSnapshot | undefined): UploadSnapshot {
  if (!snapshot) return emptyUpload()
  const cloned = structuredClone(snapshot)
  return {
    ...emptyUpload(),
    ...cloned,
    artists: (cloned.artists ?? []).map((a) => ({ ...a })),
    formats: (cloned.formats ?? []).map((f) => ({
      ...f,
      logfileNames: [...(f.logfileNames ?? [])]
    })),
    selectedTrackerIds: [...(cloned.selectedTrackerIds ?? [])],
    groupIds: { ...(cloned.groupIds ?? emptyGroupIds()) },
    groupSearch: cloned.groupSearch
      ? {
          ...cloned.groupSearch,
          queryStrings: [...(cloned.groupSearch.queryStrings ?? [])],
          trackerIds: [...(cloned.groupSearch.trackerIds ?? [])],
          results: (cloned.groupSearch.results ?? []).map((r) => ({
            ...r,
            tags: [...(r.tags ?? [])]
          }))
        }
      : emptyGroupSearch()
  }
}

export function genresToTags(genres: string[] | undefined): string {
  return (genres ?? [])
    .map((g) => g.trim().toLowerCase())
    .filter(Boolean)
    .join(', ')
}

export function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined
  const n = Number.parseInt(value.trim(), 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

export function uploadArtistsFromRelease(release: Release | undefined): UploadArtist[] {
  return (release?.artists ?? [])
    .map((artist) => {
      const name = (artist.name ?? '').trim()
      if (!name) return null
      return { name, importance: artistRoleToImportance(artist.role) }
    })
    .filter((a): a is UploadArtist => a !== null)
}

export function resolveCatalogueNumber(release: Release | undefined, cfg: Config): string {
  const catNo = (release?.catNo ?? '').trim()
  if (catNo) return catNo
  if (cfg.workflow.useUpcAsCatNo) return (release?.upc ?? '').trim()
  return ''
}

export function fingerprintUploadInputs(s: State, cfg: Config, version: string): string {
  const trackers = enabledTrackerOptions(cfg).sort().join(',')
  const proposed = s.tags.proposed ?? {}
  const jobs = (s.transcode.jobs ?? [])
    .filter((j) => j.status === 'succeeded')
    .map((j) => `${j.optionId}:${j.outputPath ?? ''}`)
    .sort()
  const selected = [...(s.transcode.selectedOptionIds ?? [])].sort()
  return JSON.stringify({
    version,
    trackers,
    workspace: s.draft.workspacePath,
    filePlan: s.files.apply.appliedHash ?? '',
    media: s.draft.sourceMedia,
    lossy: s.draft.lossyMaster,
    lossyComment: s.draft.lossyComment,
    albumDescriptionTemplateId: cfg.naming.albumDescriptionTemplateId,
    useUpcAsCatNo: cfg.workflow.useUpcAsCatNo,
    proposed: {
      artists: proposed.artists,
      title: proposed.title,
      groupYear: proposed.groupYear,
      year: proposed.year,
      editionTitle: proposed.editionTitle,
      label: proposed.label,
      catNo: proposed.catNo,
      upc: proposed.upc,
      genres: proposed.genres,
      releaseType: proposed.releaseType,
      comment: proposed.comment,
      urls: proposed.urls,
      tracks: proposed.tracks
    },
    metaUrl: s.metadata.selected?.url ?? '',
    encoding: s.transcode.inspection?.encoding,
    sampleRate: s.transcode.inspection?.sampleRate,
    hybrid: s.transcode.inspection?.hybrid,
    selected,
    jobs
  })
}

export async function buildUploadSnapshot(
  s: State,
  cfg: Config,
  options: { version: string; previousImage?: string }
): Promise<UploadSnapshot> {
  const proposed = s.tags.proposed ?? {}
  const inspection = s.transcode.inspection
  const trackerIds = enabledTrackerOptions(cfg).filter(
    (id): id is UploadTrackerId => id === 'redacted' || id === 'orpheus'
  )
  const sourceUrl = s.metadata.selected?.url?.trim() || undefined
  const trackInputs = await collectTrackDescInputs(
    s.draft.workspacePath,
    proposed.tracks,
    s.files.apply.files.map((file) => file.currentPath)
  )
  const albumDesc = generateAlbumDescription(
    trackInputs,
    albumDescMetadataFromRelease(proposed, {
      sourceUrl,
      formats: s.draft.sourceMedia || undefined,
      templateId: cfg.naming.albumDescriptionTemplateId
    })
  )
  const bitDepth = inspection?.encoding === '24bit Lossless' ? 24 : 16
  const sampleRate = inspection?.sampleRate ?? 0
  const hybrid = inspection?.hybrid ?? false
  const sourceReleaseDesc = generateReleaseDescription({
    bitDepth,
    sampleRate,
    hybrid,
    lossyMaster: s.draft.lossyMaster,
    lossyComment: s.draft.lossyComment,
    sourceUrl,
    metadataUrls: proposed.urls,
    tracks: hybrid ? trackInputs : undefined,
    version: options.version
  })

  const logfileNames =
    s.draft.sourceMedia === 'CD'
      ? (await discoverLogFiles(s.draft.workspacePath)).map((f) => f.relativePath)
      : []

  const formats: UploadFormatPayload[] = [
    {
      id: 'source',
      label: `FLAC ${inspection?.encoding ?? 'Lossless'}`,
      folderPath: s.draft.workspacePath,
      format: 'FLAC',
      bitrate: inspection?.encoding ?? 'Lossless',
      otherBitrate: '',
      vbr: false,
      releaseDesc: sourceReleaseDesc,
      logfileNames
    }
  ]

  const selectedIds = new Set(s.transcode.selectedOptionIds ?? [])
  const optionsById = new Map((inspection?.options ?? []).map((o) => [o.id, o]))
  for (const job of s.transcode.jobs ?? []) {
    if (!selectedIds.has(job.optionId)) continue
    if (job.status !== 'succeeded') continue
    if (!job.outputPath) continue
    const option = optionsById.get(job.optionId)
    if (!option) continue

    if (option.action === 'transcode' && option.bitrate) {
      formats.push({
        id: option.id,
        label: option.name,
        folderPath: job.outputPath,
        format: 'MP3',
        bitrate: trackerEncoding(option.bitrate),
        otherBitrate: '',
        vbr: option.bitrate === 'V0',
        releaseDesc: generateTranscodeDescription(
          sourceUrl ?? '',
          option.bitrate as Bitrate,
          options.version
        ),
        logfileNames: []
      })
      continue
    }

    if (option.action === 'downconvert') {
      const targetDepth = (option.targetBitDepth ?? 16) as BitDepth
      const targetRate = option.targetSampleRate ?? null
      formats.push({
        id: option.id,
        label: option.name,
        folderPath: job.outputPath,
        format: 'FLAC',
        bitrate: targetDepth === 24 ? '24bit Lossless' : 'Lossless',
        otherBitrate: '',
        vbr: false,
        releaseDesc: generateConversionDescription(
          sourceUrl ?? '',
          targetRate,
          targetDepth,
          options.version
        ),
        logfileNames: []
      })
    }
  }

  const previousImage = (options.previousImage ?? '').trim()
  const cover = await resolveCoverImage({
    workspacePath: s.draft.workspacePath,
    coverUrl: proposed.cover,
    previousImage
  })

  return {
    phase: 'ready',
    selectedTrackerIds: trackerIds,
    artists: uploadArtistsFromRelease(proposed),
    title: (proposed.title ?? '').trim(),
    year: parseYear(proposed.groupYear),
    releaseType: (proposed.releaseType ?? '').trim(),
    orpheusSplit: false,
    unknown: false,
    remasterYear: parseYear(proposed.year),
    remasterTitle: (proposed.editionTitle ?? '').trim(),
    remasterRecordLabel: (proposed.label ?? '').trim(),
    remasterCatalogueNumber: resolveCatalogueNumber(proposed, cfg),
    scene: false,
    media: s.draft.sourceMedia || '',
    tags: genresToTags(proposed.genres),
    image: cover.image,
    coverPath: cover.coverPath,
    albumDesc,
    groupIds: emptyGroupIds(),
    formats,
    groupSearch: emptyGroupSearch(),
    seededFrom: fingerprintUploadInputs(s, cfg, options.version),
    error: undefined
  }
}

// A rebuild regenerates everything derived from the tags and transcode results,
// but the user's own choices on the Upload step are not derived from anything —
// carry them across so adding a format does not reset the destinations.
function carryUserSelections(next: UploadSnapshot, previous: UploadSnapshot): UploadSnapshot {
  const selectedTrackerIds = previous.selectedTrackerIds ?? []
  // Submissions are not derived either: they are the record of which torrents
  // are already on the tracker. Dropping them on a rebuild would let the retry
  // after a partial failure upload the formats that landed a second time.
  const formatIds = new Set((next.formats ?? []).map((format) => format.id))
  const submissions = (previous.submissions ?? []).filter((sub) => formatIds.has(sub.formatId))
  return {
    ...next,
    selectedTrackerIds:
      selectedTrackerIds.length > 0 ? [...selectedTrackerIds] : next.selectedTrackerIds,
    groupIds: { ...(previous.groupIds ?? emptyGroupIds()) },
    image: previous.image ?? next.image,
    scene: previous.scene ?? next.scene,
    unknown: previous.unknown ?? next.unknown,
    orpheusSplit: previous.orpheusSplit ?? next.orpheusSplit,
    groupSearch: previous.groupSearch ?? emptyGroupSearch(),
    submissions: submissions.map((sub) => ({ ...sub })),
    // A failed submit stays failed while any of its rows survive, so the user
    // keeps the retry affordance and the reason it stopped. A failure with no
    // rows never reached the tracker — that one clears, as a rebuild means the
    // input it complained about has changed.
    ...(previous.phase === 'failed' && submissions.length > 0
      ? { phase: 'failed' as const, error: previous.error }
      : {})
  }
}

export async function ensureUploadReport(s: State, cfg: Config, version: string): Promise<State> {
  const fingerprint = fingerprintUploadInputs(s, cfg, version)
  const current = s.upload
  // Once submitted, the payload is a record of what was sent; never rebuild it.
  // The same holds mid-submit, where a rebuild would swap the descriptions out
  // from under the formats still queued to upload.
  if (current.phase === 'done' || current.phase === 'submitting') {
    return backfillCoverIfNeeded(s)
  }
  if (current.seededFrom === fingerprint && current.phase === 'ready') {
    return backfillCoverIfNeeded(s)
  }
  const next = await buildUploadSnapshot(s, cfg, {
    version,
    previousImage: current.image
  })
  return setUpload(s, carryUserSelections(next, current))
}

async function backfillCoverIfNeeded(s: State): Promise<State> {
  const current = s.upload
  if ((current.coverPath ?? '').trim()) return s
  if (!s.draft.workspacePath) return s

  const cover = await resolveCoverImage({
    workspacePath: s.draft.workspacePath,
    coverUrl: s.tags.proposed?.cover,
    previousImage: current.image
  })
  if (!cover.coverPath) return s

  return {
    ...s,
    upload: {
      ...current,
      coverPath: cover.coverPath
    }
  }
}

export async function resolveCoverImage(options: {
  workspacePath: string
  coverUrl?: string
  previousImage?: string
}): Promise<{ image: string; coverPath: string }> {
  if (!options.workspacePath) return { image: '', coverPath: '' }

  const { path: coverPath } = await downloadCoverIfNonexistent(
    options.workspacePath,
    options.coverUrl
  )
  return {
    image: (options.previousImage ?? '').trim(),
    coverPath: coverPath ?? ''
  }
}

export async function hostCoverImageForSubmit(
  s: State,
  cfg: Config
): Promise<{ image: string; error?: string }> {
  const upload = s.upload
  const existing = (upload.image ?? '').trim()
  if (existing) return { image: existing }
  if (allSelectedTrackersHaveGroupId(upload)) return { image: '' }

  const coverPath = (upload.coverPath ?? '').trim()
  if (!coverPath) return { image: '' }

  const trackerIds = (upload.selectedTrackerIds ?? []).filter(
    (id): id is UploadTrackerId => id === 'redacted' || id === 'orpheus'
  )
  const host = selectCoverImageHost(cfg, trackerIds)
  if (!host) return { image: '' }

  try {
    const image = await uploadCoverImage(cfg, host, coverPath)
    if (!image) return { image: '', error: `Failed to upload cover to ${host}.` }
    return { image }
  } catch (error) {
    return {
      image: '',
      error: error instanceof Error ? error.message : `Failed to upload cover to ${host}.`
    }
  }
}

export function updateUploadReport(s: State, patch: Partial<UploadSnapshot>): State {
  const formats = patch.formats
    ? patch.formats.map((f) => ({
        ...f,
        logfileNames: [...(f.logfileNames ?? [])]
      }))
    : s.upload.formats
  // Any edit puts the report back in play: a rejected submit must not keep the
  // step marked failed once the user has changed the field that failed. Not
  // 'submitting' — an in-flight upload owns the payload — and not 'done', which
  // is now a record of torrents that really exist on the tracker.
  const phase = s.upload.phase
  const editable = phase === 'idle' || phase === 'failed'
  return {
    ...s,
    upload: {
      ...s.upload,
      ...patch,
      artists: patch.artists ? patch.artists.map((a) => ({ ...a })) : s.upload.artists,
      selectedTrackerIds: patch.selectedTrackerIds
        ? [...patch.selectedTrackerIds]
        : s.upload.selectedTrackerIds,
      groupIds: patch.groupIds ? { ...patch.groupIds } : s.upload.groupIds,
      formats,
      groupSearch: patch.groupSearch
        ? {
            ...patch.groupSearch,
            queryStrings: [...(patch.groupSearch.queryStrings ?? [])],
            trackerIds: [...(patch.groupSearch.trackerIds ?? [])],
            results: (patch.groupSearch.results ?? []).map((r) => ({
              ...r,
              tags: [...(r.tags ?? [])]
            }))
          }
        : s.upload.groupSearch,
      phase: editable ? 'ready' : phase,
      ...(phase === 'failed' ? { error: undefined } : {})
    }
  }
}

// Resuming a saved session must not inherit an in-flight search: it would sit at
// "running" forever, and searchTrackerGroups skips a search that already claims
// to be running. Restore-path only — a live rebuild keeps its running search.
export function resumeGroupSearch(s: State): State {
  const groupSearch = s.upload.groupSearch
  if (groupSearch?.status !== 'running') return s
  return {
    ...s,
    upload: { ...s.upload, groupSearch: { ...groupSearch, status: 'idle' } }
  }
}

export function setGroupSearch(s: State, groupSearch: TrackerGroupSearchSnapshot): State {
  return {
    ...s,
    upload: {
      ...s.upload,
      groupSearch: {
        ...groupSearch,
        queryStrings: [...(groupSearch.queryStrings ?? [])],
        trackerIds: [...(groupSearch.trackerIds ?? [])],
        results: (groupSearch.results ?? []).map((r) => ({
          ...r,
          tags: [...(r.tags ?? [])]
        }))
      }
    }
  }
}

export function failUploadReport(s: State, error: string): State {
  return { ...s, upload: { ...s.upload, phase: 'failed', error } }
}

/**
 * Enter the submitting phase with one row per (tracker × format).
 *
 * Rows that already succeeded are carried across untouched — they are torrents
 * that exist on the tracker, and re-sending them would create duplicates. A row
 * that failed after its torrent was written keeps `torrentPath`/`infoHash` so
 * the retry reuses the file instead of re-hashing gigabytes.
 */
export function beginSubmit(s: State, submissions: UploadSubmission[]): State {
  const previous = new Map((s.upload.submissions ?? []).map((sub) => [sub.id, sub]))
  const next = submissions.map((submission) => {
    const before = previous.get(submission.id)
    if (before?.status === 'done') return { ...before }
    return {
      ...submission,
      torrentPath: before?.torrentPath ?? submission.torrentPath,
      infoHash: before?.infoHash ?? submission.infoHash,
      status: 'pending' as const,
      error: undefined
    }
  })
  return {
    ...s,
    upload: { ...s.upload, phase: 'submitting', submissions: next, error: undefined }
  }
}

export function patchSubmission(
  s: State,
  id: string,
  patch: Partial<UploadSubmission>
): State {
  return {
    ...s,
    upload: {
      ...s.upload,
      submissions: (s.upload.submissions ?? []).map((submission) =>
        submission.id === id ? { ...submission, ...patch } : submission
      )
    }
  }
}

/**
 * A partial success stays `failed`: some torrents are up and some are not, and
 * the user needs the retry affordance rather than a green tick.
 */
export function finishSubmit(s: State): State {
  const submissions = s.upload.submissions ?? []
  const failed = submissions.filter((sub) => sub.status !== 'done')
  if (submissions.length === 0 || failed.length > 0) {
    const succeeded = submissions.length - failed.length
    const error =
      succeeded > 0
        ? `${succeeded} of ${submissions.length} uploads succeeded — retry the rest.`
        : 'No uploads succeeded.'
    return { ...s, upload: { ...s.upload, phase: 'failed', error } }
  }
  return { ...s, upload: { ...s.upload, phase: 'done', error: undefined } }
}

/** Swap the spectral placeholder for the hosted images in every format holding one. */
export function setSpectralBbcode(s: State, bbcode: string): State {
  return {
    ...s,
    upload: {
      ...s.upload,
      spectralBbcode: bbcode,
      formats: (s.upload.formats ?? []).map((format) => ({
        ...format,
        releaseDesc: substituteSpectralBbcode(format.releaseDesc, bbcode)
      }))
    }
  }
}

/**
 * An interrupted submit is genuinely ambiguous — the POST may have landed
 * before the process died — so a restored session flags it for the user to
 * check rather than quietly offering to send it again.
 */
export function resumeSubmit(s: State): State {
  if (s.upload.phase !== 'submitting') return s
  return {
    ...s,
    upload: {
      ...s.upload,
      phase: 'failed',
      error: 'Upload was interrupted. Check the tracker before retrying.',
      submissions: (s.upload.submissions ?? []).map((submission) =>
        submission.status === 'running' || submission.status === 'pending'
          ? {
              ...submission,
              status: 'failed' as const,
              error:
                submission.status === 'running'
                  ? 'Interrupted — state unknown, check the tracker before retrying.'
                  : 'Not attempted.'
            }
          : submission
      )
    }
  }
}

async function collectTrackDescInputs(
  workspacePath: string,
  tracks: Track[] | undefined,
  orderedPaths: string[] = []
): Promise<TrackDescInput[]> {
  if (!workspacePath) {
    return (tracks ?? []).map((t) => trackToDesc(t, 0))
  }
  const files = await discoverFLACFiles(workspacePath)
  const orderedFiles = orderedPaths.length > 0
    ? orderedPaths.map((path) => files.find((file) => file.relativePath === path)).filter((file): file is NonNullable<typeof file> => Boolean(file))
    : files
  const durations: number[] = []
  for (const file of orderedFiles) {
    try {
      const info = await readFLACStreamInfo(file.absolutePath)
      durations.push(info.durationSeconds)
    } catch {
      durations.push(0)
    }
  }
  if (tracks && tracks.length > 0) {
    return tracks.map((t, i) => trackToDesc(t, durations[i] ?? 0))
  }
  return orderedFiles.map((file, i) => ({
    discNumber: '1',
    trackNumber: String(i + 1).padStart(2, '0'),
    title: file.relativePath.replace(/\.flac$/i, ''),
    artists: [],
    durationSeconds: durations[i] ?? 0
  }))
}

function trackToDesc(track: Track, durationSeconds: number): TrackDescInput {
  return {
    discNumber: track.discNumber,
    trackNumber: track.trackNumber,
    title: track.title,
    artists: (track.artists ?? []).map((a) => ({
      name: a.name,
      role: a.role
    })),
    durationSeconds
  }
}
