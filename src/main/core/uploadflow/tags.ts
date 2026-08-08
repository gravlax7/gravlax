import type { Release, TagsSnapshot, TagsStatus, Track } from '@shared/types'
import {
  FIELD_ALBUM_ARTIST,
  FIELD_ARTISTS,
  FIELD_CAT_NO,
  FIELD_COMMENT,
  FIELD_EDITION_TITLE,
  FIELD_GENRES,
  FIELD_GROUP_YEAR,
  FIELD_LABEL,
  FIELD_RELEASE_TYPE,
  FIELD_TITLE,
  FIELD_UPC,
  FIELD_URLS,
  FIELD_YEAR,
  METADATA_PROVIDER_MANUAL
} from '@shared/types/upload'
import {
  applyFeaturedArtistsFromTitle,
  cloneRelease,
  cloneTrack,
  deriveAlbumArtist,
  isMixed,
  mergeTrackFields
} from '@shared/tags/editor'
import type { State } from './state'

export function tags(s: State): TagsSnapshot {
  return structuredClone(s.tags)
}

export function setTags(s: State, snapshot: TagsSnapshot): State {
  return { ...s, tags: restoreTags(snapshot) }
}

export function setTagsCurrentLoading(s: State): State {
  return {
    ...s,
    tags: { ...s.tags, currentStatus: 'loading', currentError: '' }
  }
}

export function setTagsCurrent(s: State, release: Release): State {
  return {
    ...s,
    tags: {
      ...s.tags,
      current: cloneRelease(release),
      currentStatus: 'ready',
      currentError: ''
    }
  }
}

export function acceptAppliedTags(s: State, release: Release): State {
  return {
    ...s,
    tags: {
      ...s.tags,
      current: cloneRelease(release),
      proposed: cloneRelease(release),
      proposedDirty: false,
      currentStatus: 'ready',
      currentError: ''
    }
  }
}

export function setTagsCurrentFailed(s: State, detail: string): State {
  return {
    ...s,
    tags: { ...s.tags, currentStatus: 'failed', currentError: detail }
  }
}

export function setTagsReleaseLoading(s: State): State {
  return {
    ...s,
    tags: {
      ...s.tags,
      selected: {},
      proposed: {},
      proposedDirty: false,
      releaseStatus: 'loading',
      releaseError: ''
    }
  }
}

export function setTagsRelease(s: State, selected: Release): State {
  const current = s.tags.current ?? {}
  return {
    ...s,
    tags: {
      ...s.tags,
      selected: cloneRelease(selected),
      proposed: seedTagsProposed(current, selected),
      proposedDirty: false,
      releaseStatus: 'ready',
      releaseError: ''
    }
  }
}

export function setTagsReleaseManual(s: State): State {
  const current = cloneRelease(s.tags.current ?? {})
  return {
    ...s,
    tags: {
      ...s.tags,
      selected: current,
      proposed: cloneRelease(current),
      proposedDirty: false,
      releaseStatus: 'ready',
      releaseError: ''
    }
  }
}

export function setTagsProposed(s: State, proposed: Release): State {
  return {
    ...s,
    tags: { ...s.tags, proposed: cloneRelease(proposed), proposedDirty: true }
  }
}

export function resetTagsProposed(s: State): State {
  if (s.metadata.selected?.provider === METADATA_PROVIDER_MANUAL) {
    return setTagsReleaseManual(s)
  }
  const selected = s.tags.selected
  if (!selected || s.tags.releaseStatus !== 'ready') {
    return s
  }
  return setTagsRelease(s, selected)
}

export function setTagsReleaseFailed(s: State, detail: string): State {
  return {
    ...s,
    tags: { ...s.tags, releaseStatus: 'failed', releaseError: detail }
  }
}

export function clearTagsRelease(s: State): State {
  return {
    ...s,
    tags: {
      ...s.tags,
      selected: {},
      proposed: {},
      proposedDirty: false,
      releaseStatus: 'idle',
      releaseError: ''
    }
  }
}

export function setTagsCursor(s: State, cursor: number): State {
  if (cursor < 0) cursor = 0
  return { ...s, tags: { ...s.tags, cursor } }
}

export function restoreTags(snapshot: TagsSnapshot): TagsSnapshot {
  const next: TagsSnapshot = {
    ...snapshot,
    current: snapshot.current ? cloneRelease(snapshot.current) : undefined,
    selected: snapshot.selected ? cloneRelease(snapshot.selected) : undefined,
    proposed: snapshot.proposed ? cloneRelease(snapshot.proposed) : undefined
  }
  if (next.currentStatus === 'loading') {
    next.currentStatus = 'idle'
    next.currentError = ''
  }
  if (next.releaseStatus === 'loading') {
    next.releaseStatus = 'idle'
    next.releaseError = ''
  }
  return next
}

export function seedTagsProposed(current: Release, selected: Release): Release {
  const proposed = cloneRelease(selected)

  if ((!proposed.trackCount || proposed.trackCount <= 0) && current.trackCount && current.trackCount > 0) {
    proposed.trackCount = current.trackCount
  }
  if ((!proposed.artists || proposed.artists.length === 0) && !isMixed(current, FIELD_ARTISTS) && current.artists && current.artists.length > 0) {
    proposed.artists = current.artists.map((a) => ({ ...a }))
  }
  if (!proposed.albumArtist && !isMixed(current, FIELD_ALBUM_ARTIST) && current.albumArtist) {
    proposed.albumArtist = current.albumArtist
  }
  if (!proposed.title && !isMixed(current, FIELD_TITLE) && current.title) {
    proposed.title = current.title
  }
  if (!proposed.groupYear && !isMixed(current, FIELD_GROUP_YEAR) && current.groupYear) {
    proposed.groupYear = current.groupYear
  }
  if (!proposed.year && !isMixed(current, FIELD_YEAR) && current.year) {
    proposed.year = current.year
  }
  if (!proposed.editionTitle && !isMixed(current, FIELD_EDITION_TITLE) && current.editionTitle) {
    proposed.editionTitle = current.editionTitle
  }
  if (!proposed.label && !isMixed(current, FIELD_LABEL) && current.label) {
    proposed.label = current.label
  }
  if (!proposed.catNo && !isMixed(current, FIELD_CAT_NO) && current.catNo) {
    proposed.catNo = current.catNo
  }
  if (!proposed.upc && !isMixed(current, FIELD_UPC) && current.upc) {
    proposed.upc = current.upc
  }
  if ((!proposed.genres || proposed.genres.length === 0) && !isMixed(current, FIELD_GENRES) && current.genres && current.genres.length > 0) {
    proposed.genres = [...current.genres]
  }
  if (!proposed.releaseType && !isMixed(current, FIELD_RELEASE_TYPE) && current.releaseType) {
    proposed.releaseType = current.releaseType
  }
  if (!proposed.comment && !isMixed(current, FIELD_COMMENT) && current.comment) {
    proposed.comment = current.comment
  }
  if ((!proposed.urls || proposed.urls.length === 0) && !isMixed(current, FIELD_URLS) && current.urls && current.urls.length > 0) {
    proposed.urls = [...current.urls]
  }
  if (!proposed.albumArtist) {
    proposed.albumArtist = deriveAlbumArtist(proposed.artists ?? [])
  }
  proposed.tracks = seedProposedTracks(current.tracks ?? [], proposed.tracks ?? [])
  return proposed
}

function seedProposedTracks(currentTracks: Release['tracks'], proposedTracks: Release['tracks']): Track[] | undefined {
  const current = currentTracks ?? []
  const proposed = proposedTracks ?? []
  if (proposed.length === 0) {
    return current.length > 0
      ? current.map((track) => applyFeaturedArtistsFromTitle(cloneTrack(track)))
      : undefined
  }
  return proposed.map((track, index) => {
    const fallback = current[index]
    const merged = fallback ? mergeTrackFields(track, fallback) : cloneTrack(track)
    return applyFeaturedArtistsFromTitle(merged)
  })
}

export type { TagsStatus }
