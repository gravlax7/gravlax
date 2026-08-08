import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { UploadFormatPayload, UploadSnapshot, UploadTrackerId } from '@shared/types/upload'
import { releaseTypeId } from '@shared/upload/releaseTypes'
import type { TrackerUploadData, TrackerUploadFiles } from '@main/core/tools/trackers/types'

export interface BuildUploadDataInput {
  upload: UploadSnapshot
  format: UploadFormatPayload
  trackerId: UploadTrackerId
  /** Existing group to add this torrent to, or null/undefined to create one. */
  groupId?: number | null
}

/**
 * The multipart fields for `ajax.php?action=upload` / `upload.php`.
 *
 * `composeUploadFormData` turns `true` into `"on"` and drops `false` and
 * `undefined`, so booleans are passed through as-is rather than pre-rendered.
 */
export function buildTrackerUploadData(input: BuildUploadDataInput): TrackerUploadData {
  const { upload, format, trackerId, groupId } = input

  const common: TrackerUploadData = {
    submit: true,
    type: 0,
    remaster: true,
    remaster_year: upload.remasterYear ?? 0,
    remaster_title: upload.remasterTitle ?? '',
    remaster_record_label: upload.remasterRecordLabel ?? '',
    remaster_catalogue_number: upload.remasterCatalogueNumber ?? '',
    format: format.format,
    bitrate: format.bitrate,
    other_bitrate: format.otherBitrate,
    vbr: format.vbr,
    media: upload.media ?? '',
    release_desc: format.releaseDesc,
    scene: upload.scene ?? false
  }

  // Everything below the group level is ignored once a groupid is set — the
  // site takes the artists, title, tags, cover and album description from the
  // group that already exists.
  if (typeof groupId === 'number' && Number.isFinite(groupId)) {
    return { ...common, groupid: groupId }
  }

  const releaseType = releaseTypeId(trackerId, upload.releaseType ?? '')
  if (releaseType === null) {
    throw new Error(
      `Release type "${upload.releaseType ?? ''}" is not valid on ${trackerLabel(trackerId)}`
    )
  }

  const artists = upload.artists ?? []
  return {
    ...common,
    title: upload.title ?? '',
    'artists[]': artists.map((a) => a.name),
    'importance[]': artists.map((a) => a.importance),
    year: upload.year ?? 0,
    releasetype: releaseType,
    record_label: upload.remasterRecordLabel ?? '',
    catalogue_number: upload.remasterCatalogueNumber ?? '',
    tags: upload.tags ?? '',
    image: upload.image ?? '',
    album_desc: upload.albumDesc ?? '',
    unknown: upload.unknown ?? false
  }
}

function trackerLabel(trackerId: UploadTrackerId): string {
  return trackerId === 'orpheus' ? 'Orpheus' : 'Redacted'
}

/** Reads the rip logs discovered at report-build time into upload attachments. */
export async function collectLogFiles(
  folderPath: string,
  relativePaths: string[]
): Promise<TrackerUploadFiles['logFiles']> {
  const logFiles: NonNullable<TrackerUploadFiles['logFiles']> = []
  for (const relativePath of relativePaths) {
    const data = await readFile(join(folderPath, relativePath))
    logFiles.push({ filename: basename(relativePath), data: new Uint8Array(data) })
  }
  return logFiles
}
