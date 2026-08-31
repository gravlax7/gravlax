import { describe, expect, it } from 'vitest'
import {
  applyFeaturedArtistsFromTitle,
  applySeparatorArtistAction,
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
  keepSeparatorArtists,
  pendingSeparatorArtists,
  parseArtists,
  parseArtistCreditValues,
  separatorArtistOptions,
  setFieldEditorValue,
  setTrackFieldEditorValue,
  stripFeaturedFromTitle,
  textValueLinesEqual,
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

  it('treats equivalent Unicode forms as the same displayed value', () => {
    expect(textValueLinesEqual(['Ph\u00e9nix'], ['Phe\u0301nix'])).toBe(true)
    expect(textValueLinesEqual(['Ph\u00e9nix'], ['Phoenix'])).toBe(false)
    expect(setTrackFieldEditorValue({}, 0, 'title', 'Phe\u0301nix').tracks?.[0]?.title).toBe(
      'Ph\u00e9nix'
    )
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
      { name: 'A, B', role: 'main' },
      { name: 'C & D', role: 'guest' }
    ])
    expect(joinphraseIndicatesFeatured(' feat. ')).toBe(true)
    expect(joinphraseIndicatesFeatured(' & ')).toBe(false)
    expect(parseArtistCreditValues(['Bj\u00f6rk', 'BJO\u0308RK'])).toEqual([
      { name: 'Bj\u00f6rk', role: 'main' }
    ])
    expect(parseArtists(['O\u2019Connor [composer]', "O'Connor [composer]"])).toEqual([
      { name: 'O\u2019Connor', role: 'composer' }
    ])
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
        artists: [{ name: 'Main', role: 'main' }]
      })
    ).toEqual({
      title: 'Song',
      artists: [
        { name: 'Main', role: 'main' },
        { name: 'A & B', role: 'guest' }
      ]
    })
  })

  it('keeps list separators in artist credits until the user chooses', () => {
    expect(parseArtistCreditValues(['Bach, Jean Sebastian'])).toEqual([
      { name: 'Bach, Jean Sebastian', role: 'main' }
    ])
    expect(parseArtistCreditValues(['AC/DC'])).toEqual([{ name: 'AC/DC', role: 'main' }])
    expect(parseArtistCreditValues(['Alice / Bob'])).toEqual([
      { name: 'Alice / Bob', role: 'main' }
    ])
    expect(parseArtistCreditValues(['Earth, Wind & Fire'])).toEqual([
      { name: 'Earth, Wind & Fire', role: 'main' }
    ])
    expect(separatorArtistOptions('Bach, Jean Sebastian')).toEqual([
      { action: 'split', label: 'Jean Sebastian & Bach' },
      { action: 'reorder', label: 'Jean Sebastian Bach' },
      { action: 'keep', label: 'Keep Bach, Jean Sebastian' }
    ])
    expect(separatorArtistOptions('AC/DC')).toEqual([
      { action: 'split', label: 'AC & DC' },
      { action: 'keep', label: 'Keep AC/DC' }
    ])
    expect(separatorArtistOptions('Alice / Bob')).toEqual([
      { action: 'split', label: 'Alice & Bob' },
      { action: 'keep', label: 'Keep Alice / Bob' }
    ])
    expect(separatorArtistOptions('Earth, Wind & Fire')).toEqual([
      { action: 'split', label: 'Earth, Wind, Fire' },
      { action: 'keep', label: 'Keep Earth, Wind & Fire' }
    ])
  })

  it('applies separator choices across release and track credits', () => {
    const release: Release = {
      albumArtist: 'Bach, Jean Sebastian',
      artists: [{ name: 'Bach, Jean Sebastian', role: 'composer' }],
      tracks: [
        {
          title: 'Prelude',
          artists: [
            { name: 'Orchestra', role: 'main' },
            { name: 'Bach, Jean Sebastian', role: 'composer' }
          ]
        }
      ]
    }
    expect(pendingSeparatorArtists(release)).toEqual(['Bach, Jean Sebastian'])
    expect(applySeparatorArtistAction(release, 'Bach, Jean Sebastian', 'reorder')).toEqual({
      albumArtist: 'Jean Sebastian Bach',
      artists: [{ name: 'Jean Sebastian Bach', role: 'composer' }],
      tracks: [
        {
          title: 'Prelude',
          artists: [
            { name: 'Orchestra', role: 'main' },
            { name: 'Jean Sebastian Bach', role: 'composer' }
          ]
        }
      ]
    })
    expect(applySeparatorArtistAction(release, 'Bach, Jean Sebastian', 'split').artists).toEqual([
      { name: 'Jean Sebastian', role: 'composer' },
      { name: 'Bach', role: 'composer' }
    ])
    const kept = applySeparatorArtistAction(release, 'Bach, Jean Sebastian', 'keep')
    expect(kept.artists).toEqual([
      { name: 'Bach, Jean Sebastian', role: 'composer', separatorKept: true }
    ])
    expect(pendingSeparatorArtists(kept)).toEqual([])
    expect(keepSeparatorArtists([{ name: 'AC/DC', role: 'main' }])).toEqual([
      { name: 'AC/DC', role: 'main', separatorKept: true }
    ])
  })
})
