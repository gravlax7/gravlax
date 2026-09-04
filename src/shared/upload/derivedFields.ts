import type {
  DerivedUploadFields,
  Release,
  UploadArtist,
  UploadSnapshot
} from '@shared/types'
import { artistRoleLabel } from '@shared/tags/editor'
import { artistRoleToImportance, importanceToArtistRole } from './artists'

export type { DerivedUploadFields }

export const DERIVED_UPLOAD_FIELD_KEYS = [
  'artists',
  'title',
  'year',
  'releaseType',
  'remasterYear',
  'remasterTitle',
  'remasterRecordLabel',
  'remasterCatalogueNumber'
] as const

export type DerivedUploadFieldKey = (typeof DERIVED_UPLOAD_FIELD_KEYS)[number]

export function emptyDerivedUploadFields(): DerivedUploadFields {
  return {
    artists: [],
    title: '',
    year: undefined,
    releaseType: '',
    remasterYear: undefined,
    remasterTitle: '',
    remasterRecordLabel: '',
    remasterCatalogueNumber: ''
  }
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

export function resolveCatalogueNumber(
  release: Release | undefined,
  options: { useUpcAsCatNo: boolean }
): string {
  const catalogueNumber = (release?.catNo ?? '').trim()
  if (catalogueNumber) return catalogueNumber
  if (options.useUpcAsCatNo) return (release?.upc ?? '').trim()
  return ''
}

export function derivedUploadFieldsFromTags(
  release: Release | undefined,
  options: { useUpcAsCatNo: boolean }
): DerivedUploadFields {
  return {
    artists: uploadArtistsFromRelease(release),
    title: (release?.title ?? '').trim(),
    year: parseYear(release?.groupYear),
    releaseType: (release?.releaseType ?? '').trim(),
    remasterYear: parseYear(release?.year),
    remasterTitle: (release?.editionTitle ?? '').trim(),
    remasterRecordLabel: (release?.label ?? '').trim(),
    remasterCatalogueNumber: resolveCatalogueNumber(release, options)
  }
}

export function copyDerivedUploadFields(
  fields: DerivedUploadFields | undefined
): DerivedUploadFields {
  const source = fields ?? emptyDerivedUploadFields()
  return {
    artists: (source.artists ?? []).map((artist) => ({ ...artist })),
    title: source.title ?? '',
    year: source.year,
    releaseType: source.releaseType ?? '',
    remasterYear: source.remasterYear,
    remasterTitle: source.remasterTitle ?? '',
    remasterRecordLabel: source.remasterRecordLabel ?? '',
    remasterCatalogueNumber: source.remasterCatalogueNumber ?? ''
  }
}

export function derivedUploadFieldsFromSnapshot(
  upload: Pick<UploadSnapshot, DerivedUploadFieldKey>
): DerivedUploadFields {
  return copyDerivedUploadFields({
    artists: upload.artists ?? [],
    title: upload.title ?? '',
    year: upload.year,
    releaseType: upload.releaseType ?? '',
    remasterYear: upload.remasterYear,
    remasterTitle: upload.remasterTitle ?? '',
    remasterRecordLabel: upload.remasterRecordLabel ?? '',
    remasterCatalogueNumber: upload.remasterCatalogueNumber ?? ''
  })
}

export function derivedFieldValuesEqual(
  key: DerivedUploadFieldKey,
  left: DerivedUploadFields[DerivedUploadFieldKey],
  right: DerivedUploadFields[DerivedUploadFieldKey]
): boolean {
  if (key === 'artists') {
    return artistsEqual(left as UploadArtist[] | undefined, right as UploadArtist[] | undefined)
  }
  if (key === 'year' || key === 'remasterYear') {
    return (left ?? undefined) === (right ?? undefined)
  }
  return normalizeString(left) === normalizeString(right)
}

export function rebaseDerivedUploadFields(
  previous: Pick<UploadSnapshot, DerivedUploadFieldKey | 'derivedFromTags'>,
  nextDerived: DerivedUploadFields
): DerivedUploadFields {
  const previousDerived = previous.derivedFromTags
  if (!previousDerived) return copyDerivedUploadFields(nextDerived)

  const previousValues = derivedUploadFieldsFromSnapshot(previous)
  const rebased = copyDerivedUploadFields(nextDerived)
  for (const key of DERIVED_UPLOAD_FIELD_KEYS) {
    const wasOverride = !derivedFieldValuesEqual(key, previousValues[key], previousDerived[key])
    const sourceChanged = !derivedFieldValuesEqual(key, previousDerived[key], nextDerived[key])
    if (wasOverride && !sourceChanged) {
      assignDerivedField(rebased, key, previousValues[key])
    }
  }
  return rebased
}

export function derivedFieldMismatchMessage(
  key: DerivedUploadFieldKey,
  upload: Pick<UploadSnapshot, DerivedUploadFieldKey>,
  derived: DerivedUploadFields
): string | null {
  const current = derivedUploadFieldsFromSnapshot(upload)
  if (derivedFieldValuesEqual(key, current[key], derived[key])) return null
  const display = formatDerivedField(derived, key)
  return display ? `Differs from tags: ${display}` : null
}

export function formatDerivedField(
  derived: DerivedUploadFields,
  key: DerivedUploadFieldKey
): string {
  if (key === 'artists') {
    return (derived.artists ?? [])
      .map((artist) => ({ name: artist.name.trim(), importance: artist.importance }))
      .filter((artist) => artist.name)
      .map(
        (artist) =>
          `${artist.name} [${artistRoleLabel(importanceToArtistRole(artist.importance))}]`
      )
      .join(', ')
  }
  if (key === 'year' || key === 'remasterYear') {
    const year = derived[key]
    return year != null ? String(year) : ''
  }
  return normalizeString(derived[key])
}

function assignDerivedField(
  target: DerivedUploadFields,
  key: DerivedUploadFieldKey,
  value: DerivedUploadFields[DerivedUploadFieldKey]
): void {
  if (key === 'artists') {
    target.artists = (value as UploadArtist[]).map((artist) => ({ ...artist }))
    return
  }
  if (key === 'year' || key === 'remasterYear') {
    target[key] = value as number | undefined
    return
  }
  target[key] = String(value ?? '')
}

function artistsEqual(
  left: UploadArtist[] | undefined,
  right: UploadArtist[] | undefined
): boolean {
  const a = normalizeArtists(left)
  const b = normalizeArtists(right)
  if (a.length !== b.length) return false
  return a.every(
    (artist, index) =>
      artist.name === b[index]!.name && artist.importance === b[index]!.importance
  )
}

function normalizeArtists(artists: UploadArtist[] | undefined): UploadArtist[] {
  return (artists ?? [])
    .map((artist) => ({ name: artist.name.trim(), importance: artist.importance }))
    .filter((artist) => artist.name)
}

function normalizeString(value: unknown): string {
  return String(value ?? '').trim()
}
