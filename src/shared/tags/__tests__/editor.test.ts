import { describe, expect, it } from 'vitest'
import {
  applyFeaturedArtistsFromTitle,
  artistRoleLabel,
  cycleArtistRole,
  deriveAlbumArtist,
  displayValueLines,
  editorTrackValue,
  editorValue,
  featuredArtistsFromTitle,
  fieldDisplayName,
  fieldEditable,
  hasNamedMainArtist,
  isMultiDiscTracks,
  joinphraseIndicatesFeatured,
  parseArtistCreditValues,
  setFieldEditorValue,
  setTrackFieldEditorValue,
  stripFeaturedFromTitle,
  trackHeading
} from '@shared/tags/editor'
import type { Release } from '@shared/types'

describe('tags editor', () => {
  it('derives album artist', () => {
    expect(deriveAlbumArtist([{ name: 'A', role: 'main' }])).toBe('A')
    expect(deriveAlbumArtist([{ name: 'A', role: 'main' }, { name: 'B', role: 'main' }])).toBe('A & B')
    expect(
      deriveAlbumArtist([
        { name: 'A', role: 'main' },
        { name: 'B', role: 'main' },
        { name: 'C', role: 'main' }
      ])
    ).toBe('A, B, C')
    expect(
      deriveAlbumArtist([
        { name: 'A', role: 'main' },
        { name: 'B', role: 'main' },
        { name: 'C', role: 'main' },
        { name: 'D', role: 'main' }
      ])
    ).toBe('Various Artists')
  })

  it('round-trips artists as Name [role]', () => {
    let release: Release = {}
    release = setFieldEditorValue(release, 'artists', 'Alice [main]\nBob [guest]')
    expect(editorValue(release, 'artists')).toBe('Alice [main]\nBob [guest]')
    expect(fieldDisplayName('artists')).toBe('Artists')
    expect(fieldEditable('trackCount')).toBe(false)
  })

  it('cycles artist roles', () => {
    expect(cycleArtistRole('main', 1)).toBe('guest')
    expect(cycleArtistRole('arranger', 1)).toBe('main')
    expect(cycleArtistRole('unknown', -1)).toBe('arranger')
  })

  it('labels artist roles for display', () => {
    expect(artistRoleLabel('main')).toBe('Main')
    expect(artistRoleLabel('dj/compiler')).toBe('DJ / Compiler')
    expect(artistRoleLabel('GUEST')).toBe('Guest')
  })

  it('requires a named main artist', () => {
    expect(hasNamedMainArtist([])).toBe(false)
    expect(hasNamedMainArtist([{ name: '', role: 'main' }])).toBe(false)
    expect(hasNamedMainArtist([{ name: 'A', role: 'guest' }])).toBe(false)
    expect(hasNamedMainArtist([{ name: 'A', role: 'main' }])).toBe(true)
    expect(
      hasNamedMainArtist([
        { name: 'A', role: 'guest' },
        { name: 'B', role: 'main' }
      ])
    ).toBe(true)
  })

  it('shows empty and mixed sentinels', () => {
    expect(displayValueLines({}, 'title')).toEqual(['(empty)'])
    expect(displayValueLines({ mixed: { title: true } }, 'title')).toEqual(['mixed'])
  })

  it('edits track fields including artists', () => {
    let release: Release = {
      tracks: [{ trackNumber: '1', title: 'One', artists: [{ name: 'A', role: 'main' }] }]
    }
    release = setTrackFieldEditorValue(release, 0, 'title', 'Updated')
    release = setTrackFieldEditorValue(release, 0, 'artists', 'Alice [main]\nBob [guest]')
    release = setTrackFieldEditorValue(release, 0, 'discNumber', '2')
    release = setTrackFieldEditorValue(release, 0, 'trackNumber', '03')
    expect(release.tracks?.[0]).toEqual({
      discNumber: '2',
      trackNumber: '03',
      title: 'Updated',
      artists: [
        { name: 'Alice', role: 'main' },
        { name: 'Bob', role: 'guest' }
      ]
    })
    expect(editorTrackValue(release.tracks?.[0], 'artists')).toBe('Alice [main]\nBob [guest]')
    expect(fieldDisplayName('discNumber')).toBe('Disc')
    expect(fieldDisplayName('trackNumber')).toBe('Track')
    expect(trackHeading(release.tracks?.[0], 0, true)).toBe('2-03. Updated')
    expect(isMultiDiscTracks(release.tracks ?? [])).toBe(true)
  })

  it('parses featured artists as guest by default', () => {
    expect(parseArtistCreditValues(['Four Tet feat. Burial'])).toEqual([
      { name: 'Four Tet', role: 'main' },
      { name: 'Burial', role: 'guest' }
    ])
    expect(parseArtistCreditValues(['Four Tet (feat. Burial)'])).toEqual([
      { name: 'Four Tet', role: 'main' },
      { name: 'Burial', role: 'guest' }
    ])
    expect(parseArtistCreditValues(['A, B ft. C & D'])).toEqual([
      { name: 'A', role: 'main' },
      { name: 'B', role: 'main' },
      { name: 'C', role: 'guest' },
      { name: 'D', role: 'guest' }
    ])
    expect(joinphraseIndicatesFeatured(' feat. ')).toBe(true)
    expect(joinphraseIndicatesFeatured(' & ')).toBe(false)
  })

  it('adds featured artists from track titles as guests', () => {
    expect(featuredArtistsFromTitle('PARACHUTE CHANEL (feat. Sneazzy)')).toEqual([
      { name: 'Sneazzy', role: 'guest' }
    ])
    expect(stripFeaturedFromTitle('PARACHUTE CHANEL (feat. Sneazzy)')).toBe('PARACHUTE CHANEL')
    expect(
      applyFeaturedArtistsFromTitle({
        title: 'PARACHUTE CHANEL (feat. Sneazzy)',
        artists: [{ name: 'Alpha Wann', role: 'main' }]
      })
    ).toEqual({
      title: 'PARACHUTE CHANEL',
      artists: [
        { name: 'Alpha Wann', role: 'main' },
        { name: 'Sneazzy', role: 'guest' }
      ]
    })
    expect(
      applyFeaturedArtistsFromTitle({
        title: 'Song feat. A & B',
        artists: [{ name: 'Main', role: 'main' }, { name: 'A', role: 'guest' }]
      })
    ).toEqual({
      title: 'Song',
      artists: [
        { name: 'Main', role: 'main' },
        { name: 'A', role: 'guest' },
        { name: 'B', role: 'guest' }
      ]
    })
  })
})
