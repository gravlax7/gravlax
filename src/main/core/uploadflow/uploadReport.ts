import type { Config, CoverImageHostId } from '@shared/types/config'
import { trackerName } from '@shared/trackers'
import type {
  BitDepth,
  Bitrate,
  HostedCoverImage,
  Release,
  Track,
  UploadArtist,
  UploadFormatPayload,
  UploadSnapshot,
  UploadTrackerId
} from '@shared/types'
import { enabledTrackerOptions } from '@shared/config/trackers'
import { discoverLogFiles } from '@main/core/tools/diagnostics/sourceMedia'
import { discoverFLACFiles } from '@main/core/tools/flacFiles'
import { enumerateReleaseFiles, totalSize } from '@main/core/tools/releaseFiles'
import { readFLACStreamInfo } from '@main/core/tools/diagnostics/mqa'
import {
  albumDescMetadataFromRelease,
  generateAlbumDescription,
  generateReleaseDescription,
  type TrackDescInput
} from '@main/core/tools/upload/descriptions'
import {
  generateConversionDescription,
  generateTranscodeDescription
} from '@main/core/tools/transcode'
import { downloadCoverIfNonexistent } from '@main/core/tools/upload/cover'
import { uploadImageToHost } from '@main/core/tools/imagehosts/upload'
import { artistRoleToImportance } from '@shared/upload/artists'
import { isCoverImageHostId } from '@shared/config/imageHosts'
import { trackerEncoding } from '@shared/upload/encodings'
import { emptyGroupIds } from '@shared/upload/groupIds'
import type { State } from './state'
import { emptyGroupSearch } from './groupSearch'

export function genresToTags(genres: string[] | undefined): string {
  return (genres ?? [])
    .map((genre) => genre.trim().toLowerCase())
    .filter(Boolean)
    .join(', ')
}

export function resolveUploadTags(s: State): string {
  const proposed = genresToTags(s.tags.proposed?.genres)
  if (proposed) return proposed
  return genresToTags(s.tags.current?.genres)
}

export function parseYear(value: string | undefined): number | undefined {
  if (!value) return undefined
  const year = Number.parseInt(value.trim(), 10)
  return Number.isFinite(year) && year > 0 ? year : undefined
}

export function uploadArtistsFromRelease(release: Release | undefined): UploadArtist[] {
  return (release?.artists ?? [])
    .map((artist) => {
      const name = (artist.name ?? '').trim()
      if (!name) return null
      return { name, importance: artistRoleToImportance(artist.role) }
    })
    .filter((artist): artist is UploadArtist => artist !== null)
}

export function resolveCatalogueNumber(release: Release | undefined, cfg: Config): string {
  const catalogueNumber = (release?.catNo ?? '').trim()
  if (catalogueNumber) return catalogueNumber
  if (cfg.workflow.useUpcAsCatNo) return (release?.upc ?? '').trim()
  return ''
}

export function fingerprintUploadInputs(s: State, cfg: Config, version: string): string {
  const trackers = enabledTrackerOptions(cfg).sort().join(',')
  const proposed = s.tags.proposed ?? {}
  const jobs = (s.transcode.jobs ?? [])
    .filter((job) => job.status === 'succeeded')
    .map((job) => `${job.optionId}:${job.outputPath ?? ''}`)
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
  const trackerIds = enabledTrackerOptions(cfg)
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
      ? (await discoverLogFiles(s.draft.workspacePath)).map((file) => file.relativePath)
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
  const optionsById = new Map((inspection?.options ?? []).map((option) => [option.id, option]))
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
        releaseDesc: generateTranscodeDescription(option.bitrate as Bitrate, options.version),
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
        releaseDesc: generateConversionDescription(targetRate, targetDepth, options.version),
        logfileNames: []
      })
    }
  }

  const cover = await resolveCoverImage({
    workspacePath: s.draft.workspacePath,
    coverUrl: proposed.cover,
    previousImage: options.previousImage
  })
  const sizedFormats = await Promise.all(
    formats.map(async (format) => ({
      ...format,
      sizeBytes: totalSize(await enumerateReleaseFiles(format.folderPath))
    }))
  )

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
    tags: resolveUploadTags(s),
    image: cover.image,
    coverPath: cover.coverPath,
    hostedCoverImages: {},
    albumDesc,
    groupIds: emptyGroupIds(),
    formats: sizedFormats,
    groupSearch: emptyGroupSearch(),
    seededFrom: fingerprintUploadInputs(s, cfg, options.version),
    error: undefined
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

export interface HostCoverImagesResult {
  hostedCoverImages: Partial<Record<UploadTrackerId, HostedCoverImage>>
  error?: string
}

export async function hostCoverImagesForSubmit(
  s: State,
  cfg: Config,
  trackerIds: readonly UploadTrackerId[]
): Promise<HostCoverImagesResult> {
  const upload = s.upload
  const hostedCoverImages = structuredClone(upload.hostedCoverImages ?? {})
  if ((upload.image ?? '').trim()) return { hostedCoverImages }

  const coverPath = (upload.coverPath ?? '').trim()
  if (!coverPath) return { hostedCoverImages }

  const trackersByHost = new Map<CoverImageHostId, UploadTrackerId[]>()
  const savedUrlByHost = new Map<CoverImageHostId, string>()
  for (const image of Object.values(hostedCoverImages)) {
    if (image && isCoverImageHostId(image.host) && image.url.trim()) {
      savedUrlByHost.set(image.host, image.url.trim())
    }
  }
  const errors: string[] = []
  for (const trackerId of trackerIds) {
    const groupId = upload.groupIds?.[trackerId]
    if (typeof groupId === 'number' && Number.isFinite(groupId)) continue

    const host = cfg.trackers[trackerId].coverImageHost.trim()
    if (!host) {
      delete hostedCoverImages[trackerId]
      continue
    }
    if (!isCoverImageHostId(host)) {
      delete hostedCoverImages[trackerId]
      errors.push(`${trackerName(trackerId)} has an invalid cover image host: ${host}.`)
      continue
    }

    const existing = hostedCoverImages[trackerId]
    if (existing?.host === host && existing.url.trim()) continue
    const savedUrl = savedUrlByHost.get(host)
    if (savedUrl) {
      hostedCoverImages[trackerId] = { host, url: savedUrl }
      continue
    }
    const trackers = trackersByHost.get(host) ?? []
    trackers.push(trackerId)
    trackersByHost.set(host, trackers)
  }

  for (const [host, trackers] of trackersByHost) {
    try {
      const url = await uploadImageToHost(cfg, host, coverPath)
      if (!url) {
        errors.push(coverHostError(trackers, host))
        continue
      }
      for (const trackerId of trackers) {
        hostedCoverImages[trackerId] = { host, url }
      }
    } catch (error) {
      const detail = error instanceof Error ? ` ${error.message}` : ''
      errors.push(`${coverHostError(trackers, host)}${detail}`)
    }
  }

  return {
    hostedCoverImages,
    ...(errors.length > 0 ? { error: errors.join(' ') } : {})
  }
}

function coverHostError(trackers: readonly UploadTrackerId[], host: CoverImageHostId): string {
  const names = trackers.map(trackerName).join(' and ')
  return `Failed to upload ${names} cover to ${host}.`
}

async function collectTrackDescInputs(
  workspacePath: string,
  tracks: Track[] | undefined,
  orderedPaths: string[] = []
): Promise<TrackDescInput[]> {
  if (!workspacePath) {
    return (tracks ?? []).map((track) => trackToDesc(track, 0))
  }
  const files = await discoverFLACFiles(workspacePath)
  const orderedFiles =
    orderedPaths.length > 0
      ? orderedPaths
          .map((path) => files.find((file) => file.relativePath === path))
          .filter((file): file is NonNullable<typeof file> => Boolean(file))
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
    return tracks.map((track, index) => trackToDesc(track, durations[index] ?? 0))
  }
  return orderedFiles.map((file, index) => ({
    discNumber: '1',
    trackNumber: String(index + 1).padStart(2, '0'),
    title: file.relativePath.replace(/\.flac$/i, ''),
    artists: [],
    durationSeconds: durations[index] ?? 0
  }))
}

function trackToDesc(track: Track, durationSeconds: number): TrackDescInput {
  return {
    discNumber: track.discNumber,
    trackNumber: track.trackNumber,
    title: track.title,
    artists: (track.artists ?? []).map((artist) => ({
      name: artist.name,
      role: artist.role
    })),
    durationSeconds
  }
}
