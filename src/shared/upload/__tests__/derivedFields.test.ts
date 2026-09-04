import { describe, expect, it } from 'vitest'
import {
  copyDerivedUploadFields,
  derivedFieldMismatchMessage,
  derivedFieldValuesEqual,
  derivedUploadFieldsFromTags,
  emptyDerivedUploadFields,
  parseYear,
  rebaseDerivedUploadFields,
  resolveCatalogueNumber,
  uploadArtistsFromRelease
} from '../derivedFields'

describe('parseYear', () => {
  it('parses years including longer stored dates', () => {
    expect(parseYear('2020')).toBe(2020)
    expect(parseYear('2018-09-21')).toBe(2018)
    expect(parseYear('')).toBeUndefined()
  })
})

describe('uploadArtistsFromRelease', () => {
  it('builds upload artists from release', () => {
    expect(
      uploadArtistsFromRelease({
        artists: [
          { name: 'A', role: 'main' },
          { name: 'B', role: 'guest' },
          { name: 'A', role: 'composer' },
          { name: 'C', role: 'conductor' },
          { name: '  ', role: 'main' }
        ]
      })
    ).toEqual([
      { name: 'A', importance: 1 },
      { name: 'B', importance: 2 },
      { name: 'A', importance: 4 },
      { name: 'C', importance: 5 }
    ])
  })
})

describe('resolveCatalogueNumber', () => {
  it('uses UPC as catalogue number when CatNo is missing and toggle is on', () => {
    expect(resolveCatalogueNumber({ upc: '602567971092' }, { useUpcAsCatNo: true })).toBe(
      '602567971092'
    )
    expect(
      resolveCatalogueNumber({ catNo: '6797109', upc: '602567971092' }, { useUpcAsCatNo: true })
    ).toBe('6797109')
    expect(resolveCatalogueNumber({ upc: '602567971092' }, { useUpcAsCatNo: false })).toBe('')
  })
})

describe('derivedUploadFieldsFromTags', () => {
  it('maps tag fields onto the upload snapshot shape', () => {
    expect(
      derivedUploadFieldsFromTags(
        {
          artists: [{ name: 'A', role: 'main' }],
          title: ' Album ',
          groupYear: '2020-01-01',
          releaseType: 'EP',
          year: '2021',
          editionTitle: 'Remaster',
          label: 'Label',
          catNo: 'CAT-1'
        },
        { useUpcAsCatNo: false }
      )
    ).toEqual({
      artists: [{ name: 'A', importance: 1 }],
      title: 'Album',
      year: 2020,
      releaseType: 'EP',
      remasterYear: 2021,
      remasterTitle: 'Remaster',
      remasterRecordLabel: 'Label',
      remasterCatalogueNumber: 'CAT-1'
    })
  })
})

describe('derivedFieldValuesEqual', () => {
  it('treats empty and typed title as different', () => {
    expect(derivedFieldValuesEqual('title', '', 'Album')).toBe(false)
    expect(derivedFieldValuesEqual('title', 'Album', 'Album')).toBe(true)
    expect(derivedFieldValuesEqual('title', ' Album ', 'Album')).toBe(true)
  })

  it('treats an artist role change as different', () => {
    expect(
      derivedFieldValuesEqual(
        'artists',
        [{ name: 'A', importance: 1 }],
        [{ name: 'A', importance: 2 }]
      )
    ).toBe(false)
    expect(
      derivedFieldValuesEqual(
        'artists',
        [{ name: 'A', importance: 1 }],
        [{ name: ' A ', importance: 1 }]
      )
    ).toBe(true)
  })
})

describe('derivedFieldMismatchMessage', () => {
  it('does not warn when tags have no value for the field', () => {
    const derived = emptyDerivedUploadFields()
    expect(derivedFieldMismatchMessage('title', { title: 'Album' }, derived)).toBeNull()
  })

  it('shows the tag value when the upload field differs', () => {
    const derived = derivedUploadFieldsFromTags(
      { title: 'Album', artists: [{ name: 'A', role: 'guest' }] },
      { useUpcAsCatNo: false }
    )
    expect(derivedFieldMismatchMessage('title', { title: 'Other' }, derived)).toBe(
      'Differs from tags: Album'
    )
    expect(
      derivedFieldMismatchMessage('artists', { artists: [{ name: 'A', importance: 1 }] }, derived)
    ).toBe('Differs from tags: A [Guest]')
  })

  it('returns null when the field matches tags', () => {
    const derived = derivedUploadFieldsFromTags({ title: 'Album' }, { useUpcAsCatNo: false })
    expect(derivedFieldMismatchMessage('title', { title: 'Album' }, derived)).toBeNull()
  })
})

describe('rebaseDerivedUploadFields', () => {
  it('keeps an override when that tag field did not change', () => {
    const previous = {
      ...emptyDerivedUploadFields(),
      title: 'Override',
      derivedFromTags: { ...emptyDerivedUploadFields(), title: 'Album' }
    }
    const next = { ...emptyDerivedUploadFields(), title: 'Album', remasterTitle: 'Deluxe' }
    expect(rebaseDerivedUploadFields(previous, next).title).toBe('Override')
    expect(rebaseDerivedUploadFields(previous, next).remasterTitle).toBe('Deluxe')
  })

  it('adopts a new tag value when that field changed', () => {
    const previous = {
      ...emptyDerivedUploadFields(),
      title: 'Override',
      derivedFromTags: { ...emptyDerivedUploadFields(), title: 'Album' }
    }
    const next = { ...emptyDerivedUploadFields(), title: 'Album II' }
    expect(rebaseDerivedUploadFields(previous, next).title).toBe('Album II')
  })

  it('takes the new derived fields when no previous baseline exists', () => {
    const previous = { ...emptyDerivedUploadFields(), title: 'Stale' }
    const next = { ...emptyDerivedUploadFields(), title: 'Album' }
    expect(rebaseDerivedUploadFields(previous, next).title).toBe('Album')
  })
})

describe('copyDerivedUploadFields', () => {
  it('clones artists', () => {
    const source = derivedUploadFieldsFromTags(
      { artists: [{ name: 'A', role: 'main' }] },
      { useUpcAsCatNo: false }
    )
    const copied = copyDerivedUploadFields(source)
    copied.artists[0]!.name = 'B'
    expect(source.artists[0]!.name).toBe('A')
  })
})
