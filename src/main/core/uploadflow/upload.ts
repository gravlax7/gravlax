import { isDeepStrictEqual } from 'node:util'
import type { Config } from '@shared/types/config'
import type {
  TrackerGroupSearchSnapshot,
  UploadFormatPayload,
  UploadSnapshot,
  UploadSubmission
} from '@shared/types'
import { substituteSpectralBbcode } from '@main/core/tools/upload/descriptions'
import { emptyGroupIds } from '@shared/upload/groupIds'
import type { State } from './state'
import { emptyGroupSearch } from './groupSearch'
import {
  buildUploadSnapshot,
  fingerprintUploadInputs,
  resolveCoverImage,
  resolveUploadTags
} from './uploadReport'

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

function copyFormats(
  formats: UploadFormatPayload[] | undefined
): UploadFormatPayload[] | undefined {
  return formats?.map((format) => ({
    ...format,
    logfileNames: [...(format.logfileNames ?? [])]
  }))
}

function copyGroupSearch(
  groupSearch: TrackerGroupSearchSnapshot | undefined
): TrackerGroupSearchSnapshot {
  if (!groupSearch) return emptyGroupSearch()
  return {
    ...groupSearch,
    queryStrings: [...(groupSearch.queryStrings ?? [])],
    trackerIds: [...(groupSearch.trackerIds ?? [])],
    results: (groupSearch.results ?? []).map((result) => ({
      ...result,
      tags: [...(result.tags ?? [])]
    }))
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
    artists: (cloned.artists ?? []).map((artist) => ({ ...artist })),
    formats: copyFormats(cloned.formats) ?? [],
    selectedTrackerIds: [...(cloned.selectedTrackerIds ?? [])],
    groupIds: { ...(cloned.groupIds ?? emptyGroupIds()) },
    groupSearch: copyGroupSearch(cloned.groupSearch)
  }
}

// A rebuild regenerates everything derived from the tags and transcode results,
// but the user's own choices on the Upload step are not derived from anything —
// carry them across so adding a format does not reset the destinations.
function carryUserSelections(next: UploadSnapshot, previous: UploadSnapshot): UploadSnapshot {
  const selectedTrackerIds = previous.selectedTrackerIds ?? []
  const hasPreviousReport = previous.phase !== 'idle'
  // Submissions are not derived either: they are the record of which torrents
  // are already on the tracker. Dropping them on a rebuild would let the retry
  // after a partial failure upload the formats that landed a second time.
  const formatIds = new Set((next.formats ?? []).map((format) => format.id))
  const submissions = (previous.submissions ?? []).filter((sub) => formatIds.has(sub.formatId))
  return {
    ...next,
    selectedTrackerIds:
      hasPreviousReport ? [...selectedTrackerIds] : next.selectedTrackerIds,
    groupIds: { ...(previous.groupIds ?? emptyGroupIds()) },
    image: previous.image ?? next.image,
    scene: previous.scene ?? next.scene,
    unknown: previous.unknown ?? next.unknown,
    orpheusSplit: previous.orpheusSplit ?? next.orpheusSplit,
    groupSearch: previous.groupSearch ?? emptyGroupSearch(),
    tags: (previous.tags ?? '').trim() ? previous.tags : next.tags,
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

/**
 * Commit a report built from `before` without losing changes made while its
 * file reads were in flight. Generated fields come from `built`; live upload
 * state and user edits that changed since `before` come from `latest`.
 */
export function mergeConcurrentUploadReport(
  before: UploadSnapshot,
  built: UploadSnapshot,
  latest: UploadSnapshot
): UploadSnapshot {
  const merged = structuredClone(built)
  const liveFields = [
    'phase',
    'selectedTrackerIds',
    'orpheusSplit',
    'unknown',
    'scene',
    'tags',
    'image',
    'coverPath',
    'albumDesc',
    'groupIds',
    'groupSearch',
    'submissions',
    'spectralBbcode',
    'error'
  ] as const satisfies readonly (keyof UploadSnapshot)[]

  for (const field of liveFields) {
    if (isDeepStrictEqual(before[field], latest[field])) continue
    Object.assign(merged, { [field]: structuredClone(latest[field]) })
  }

  merged.formats = mergeConcurrentFormatChanges(before.formats, built.formats, latest.formats)
  return merged
}

function mergeConcurrentFormatChanges(
  before: UploadFormatPayload[] | undefined,
  built: UploadFormatPayload[] | undefined,
  latest: UploadFormatPayload[] | undefined
): UploadFormatPayload[] | undefined {
  if (!built) return built
  const beforeById = new Map((before ?? []).map((format) => [format.id, format]))
  const latestById = new Map((latest ?? []).map((format) => [format.id, format]))

  return built.map((builtFormat) => {
    const beforeFormat = beforeById.get(builtFormat.id)
    const latestFormat = latestById.get(builtFormat.id)
    const releaseDescChanged =
      latestFormat &&
      (!beforeFormat || !isDeepStrictEqual(beforeFormat.releaseDesc, latestFormat.releaseDesc))
    return {
      ...builtFormat,
      releaseDesc: releaseDescChanged ? latestFormat.releaseDesc : builtFormat.releaseDesc,
      logfileNames: [...builtFormat.logfileNames]
    }
  })
}

export async function ensureUploadReport(s: State, cfg: Config, version: string): Promise<State> {
  const fingerprint = fingerprintUploadInputs(s, cfg, version)
  const current = s.upload
  // Once submitted, the payload is a record of what was sent; never rebuild it.
  // The same holds mid-submit, where a rebuild would swap the descriptions out
  // from under the formats still queued to upload.
  if (current.phase === 'done' || current.phase === 'submitting') {
    return backfillUploadFieldsIfNeeded(s)
  }
  if (current.seededFrom === fingerprint && current.phase === 'ready') {
    return backfillUploadFieldsIfNeeded(s)
  }
  const next = await buildUploadSnapshot(s, cfg, {
    version,
    previousImage: current.image
  })
  return setUpload(s, carryUserSelections(next, current))
}

async function backfillUploadFieldsIfNeeded(s: State): Promise<State> {
  let next = backfillTagsIfNeeded(s)
  return backfillCoverIfNeeded(next)
}

function backfillTagsIfNeeded(s: State): State {
  if ((s.upload.tags ?? '').trim()) return s
  const tags = resolveUploadTags(s)
  if (!tags) return s
  return {
    ...s,
    upload: {
      ...s.upload,
      tags
    }
  }
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

export function updateUploadReport(s: State, patch: Partial<UploadSnapshot>): State {
  const formats = patch.formats ? copyFormats(patch.formats) : s.upload.formats
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
      artists: patch.artists
        ? patch.artists.map((artist) => ({ ...artist }))
        : s.upload.artists,
      selectedTrackerIds: patch.selectedTrackerIds
        ? [...patch.selectedTrackerIds]
        : s.upload.selectedTrackerIds,
      groupIds: patch.groupIds ? { ...patch.groupIds } : s.upload.groupIds,
      formats,
      groupSearch: patch.groupSearch ? copyGroupSearch(patch.groupSearch) : s.upload.groupSearch,
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
      groupSearch: copyGroupSearch(groupSearch)
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
  // The books only close when every row is terminal. A row still pending or
  // running was never finished by the submit loop; counting it as a failure
  // would hide an upload that is genuinely in flight.
  const unfinished = submissions.filter(
    (submission) => submission.status !== 'done' && submission.status !== 'failed'
  )
  if (unfinished.length > 0) {
    throw new Error(
      `finishSubmit: ${unfinished.length} submission(s) never reached a terminal state: ${unfinished
        .map((submission) => submission.id)
        .join(', ')}`
    )
  }
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
