import { describe, expect, it } from 'vitest'
import { dateYear, isValidDateShape, metadataDate } from '../dates'
import {
  combineManagedAndSourceTags,
  discTrackTotal,
  dropTranscodeOnlyTags,
  firstAliasValue,
  managedRemovalKeys,
  managedTagProjection,
  mergeAliasValues,
  releaseDiscTotal,
  trackArtistValue
} from '../projection'
import type { Release } from '@shared/types'

function release(patch: Release = {}): Release {
  return {
    title: 'Album',
    albumArtist: 'Artist',
    groupYear: '2018',
    year: '2020',
    label: 'Label',
    catNo: 'CAT-1',
    upc: '012345678901',
    genres: ['Rock', 'ambient'],
    releaseType: 'Album',
    comment: 'Note',
    tracks: [
      {
        title: 'Song',
        trackNumber: '1',
        discNumber: '1',
        artists: [{ name: 'Artist', role: 'main' }]
      }
    ],
    ...patch
  }
}

describe('date shapes', () => {
  it('accepts empty and the three stored shapes', () => {
    expect(isValidDateShape('')).toBe(true)
    expect(isValidDateShape('2018')).toBe(true)
    expect(isValidDateShape('2018-09')).toBe(true)
    expect(isValidDateShape('2018-09-21')).toBe(true)
    expect(isValidDateShape('2018/09/21')).toBe(false)
    expect(isValidDateShape('2018-9-21')).toBe(false)
    expect(isValidDateShape('September 2018')).toBe(false)
  })

  it('takes a year when a year is needed and keeps stored strings', () => {
    expect(dateYear('2018-09-21')).toBe('2018')
    expect(dateYear('2018')).toBe('2018')
    expect(metadataDate('2018-09-21')).toBe('2018-09-21')
    expect(metadataDate('2018-09-21T00:00:00')).toBe('2018-09-21')
    expect(metadataDate('March 2018')).toBe('2018')
  })
})

describe('managedTagProjection', () => {
  it('writes album and track tags in a stable order', () => {
    const tags = managedTagProjection(release(), 0)
    expect([...tags.keys()]).toEqual([
      'ALBUM',
      'ALBUMARTIST',
      'ALBUMARTISTS',
      'ORIGINALDATE',
      'DATE',
      'LABEL',
      'CATALOGNUMBER',
      'BARCODE',
      'UPC',
      'GENRE',
      'RELEASETYPE',
      'COMMENT',
      'TITLE',
      'ARTIST',
      'ARTISTS',
      'TRACKNUMBER',
      'DISCNUMBER',
      'TRACKTOTAL',
      'DISCTOTAL'
    ])
    expect(tags.get('ALBUM')).toEqual(['Album'])
    expect(tags.get('ALBUMARTISTS')).toEqual(['Artist'])
    expect(tags.get('ORIGINALDATE')).toEqual(['2018'])
    expect(tags.get('DATE')).toEqual(['2020'])
    expect(tags.get('BARCODE')).toEqual(['012345678901'])
    expect(tags.get('UPC')).toEqual(['012345678901'])
    expect(tags.get('GENRE')).toEqual(['ambient; Rock'])
    expect(tags.get('ARTISTS')).toEqual(['Artist'])
  })

  it('writes the edition title as its own tag', () => {
    const tags = managedTagProjection(release({ editionTitle: 'Deluxe Edition' }), 0)
    expect(tags.get('ALBUM')).toEqual(['Album'])
    expect(tags.get('EDITIONTITLE')).toEqual(['Deluxe Edition'])
  })

  it('uses DATE for both dates when the original date is missing', () => {
    const tags = managedTagProjection(release({ groupYear: '', year: '2020-05' }), 0)
    expect(tags.get('DATE')).toEqual(['2020-05'])
    expect(tags.get('ORIGINALDATE')).toEqual(['2020-05'])
  })

  it('uses the original date for DATE when the edition date is missing', () => {
    const tags = managedTagProjection(release({ groupYear: '2018-09-21', year: '' }), 0)
    expect(tags.get('DATE')).toEqual(['2018-09-21'])
    expect(tags.get('ORIGINALDATE')).toEqual(['2018-09-21'])
  })

  it('omits empty managed values', () => {
    const tags = managedTagProjection(
      release({
        label: '',
        catNo: '',
        upc: '',
        genres: [],
        releaseType: '',
        comment: ''
      }),
      0
    )
    expect(tags.has('LABEL')).toBe(false)
    expect(tags.has('CATALOGNUMBER')).toBe(false)
    expect(tags.has('UPC')).toBe(false)
    expect(tags.has('BARCODE')).toBe(false)
    expect(tags.has('GENRE')).toBe(false)
    expect(tags.has('RELEASETYPE')).toBe(false)
    expect(tags.has('COMMENT')).toBe(false)
  })

  it('writes DJ/compiler as DJMIXER with the other role tags', () => {
    const tags = managedTagProjection(
      release({
        tracks: [{
          title: 'Mix',
          trackNumber: '1',
          discNumber: '1',
          artists: [
            { name: 'Main', role: 'main' },
            { name: 'Guest', role: 'guest' },
            { name: 'Writer', role: 'composer' },
            { name: 'Maestro', role: 'conductor' },
            { name: 'DJ', role: 'dj/compiler' },
            { name: 'Remixer', role: 'remixer' },
            { name: 'Producer', role: 'producer' },
            { name: 'Arranger', role: 'arranger' }
          ]
        }]
      }),
      0
    )
    expect(tags.get('ARTIST')).toEqual(['Main, Maestro (feat. Guest)'])
    expect(tags.get('ARTISTS')).toEqual(['Main'])
    expect(tags.get('COMPOSER')).toEqual(['Writer'])
    expect(tags.get('CONDUCTOR')).toEqual(['Maestro'])
    expect(tags.get('REMIXER')).toEqual(['Remixer'])
    expect(tags.get('DJMIXER')).toEqual(['DJ'])
    expect(tags.get('PRODUCER')).toEqual(['Producer'])
    expect(tags.get('ARRANGER')).toEqual(['Arranger'])
  })

  it('counts TRACKTOTAL per disc', () => {
    const multi = release({
      tracks: [
        { title: 'A', trackNumber: '1', discNumber: '1' },
        { title: 'B', trackNumber: '2', discNumber: '1' },
        { title: 'C', trackNumber: '1', discNumber: '2' }
      ]
    })
    expect(discTrackTotal(multi.tracks ?? [], '1')).toBe(2)
    expect(discTrackTotal(multi.tracks ?? [], '2')).toBe(1)
    expect(releaseDiscTotal(multi.tracks ?? [])).toBe(2)
    expect(managedTagProjection(multi, 0).get('TRACKTOTAL')).toEqual(['2'])
    expect(managedTagProjection(multi, 2).get('TRACKTOTAL')).toEqual(['1'])
    expect(managedTagProjection(multi, 0).get('DISCTOTAL')).toEqual(['2'])
  })
})

describe('aliases and preserved tags', () => {
  it('reads the first non-empty single-value alias', () => {
    expect(
      firstAliasValue({ YEAR: ['2018'], DATE: ['2020-01-01'] }, 'DATE')
    ).toBe('2020-01-01')
    expect(firstAliasValue({ YEAR: ['2018'] }, 'DATE')).toBe('2018')
  })

  it('merges multi-value aliases without duplicates', () => {
    expect(
      mergeAliasValues(
        { COMPOSER: ['Bach', 'Bach'], 'MIXARTIST': ['Remixer'] },
        'COMPOSER'
      )
    ).toEqual(['Bach'])
    expect(mergeAliasValues({ REMIXER: ['A'], MIXARTIST: ['A', 'B'] }, 'REMIXER')).toEqual([
      'A',
      'B'
    ])
    expect(mergeAliasValues({ 'DJ MIXER': ['Selector'] }, 'DJMIXER')).toEqual(['Selector'])
  })

  it('removes managed aliases and keeps unrelated source tags', () => {
    const combined = combineManagedAndSourceTags(
      {
        TITLE: ['Old'],
        YEAR: ['1999'],
        EDITIONTITLE: ['Deluxe'],
        PUBLISHER: ['Source Publisher'],
        COPYRIGHT: ['2020 Label'],
        ISRC: ['GB-ABC-12-34567'],
        REPLAYGAIN_TRACK_GAIN: ['-7.00 dB']
      },
      managedTagProjection(release({ title: 'New' }), 0)
    )
    expect(combined.TITLE).toEqual(['Song'])
    expect(combined.YEAR).toBeUndefined()
    expect(combined.EDITIONTITLE).toBeUndefined()
    expect(combined.PUBLISHER).toEqual(['Source Publisher'])
    expect(combined.COPYRIGHT).toEqual(['2020 Label'])
    expect(combined.ISRC).toEqual(['GB-ABC-12-34567'])
    expect(combined.REPLAYGAIN_TRACK_GAIN).toEqual(['-7.00 dB'])
    expect(combined.DATE).toEqual(['2020'])
    expect(Object.keys(combined).slice(0, 5)).toEqual([
      'ALBUM',
      'ALBUMARTIST',
      'ALBUMARTISTS',
      'ORIGINALDATE',
      'DATE'
    ])
  })

  it('drops ReplayGain and encoder tags from transcode copies', () => {
    expect(
      dropTranscodeOnlyTags({
        TITLE: ['Song'],
        REPLAYGAIN_TRACK_GAIN: ['-7.00 dB'],
        ENCODER: ['Lavf']
      })
    ).toEqual({ TITLE: ['Song'] })
  })

  it('lists every alias for removal', () => {
    const keys = managedRemovalKeys()
    expect(keys).toContain('YEAR')
    expect(keys).toContain('EDITIONTITLE')
    expect(keys).toContain('CATNO')
    expect(keys).toContain('DJMIXER')
    expect(keys).not.toContain('PUBLISHER')
    expect(keys).not.toContain('COPYRIGHT')
  })
})

describe('trackArtistValue', () => {
  it('joins mains and guests', () => {
    expect(
      trackArtistValue([
        { name: 'A', role: 'main' },
        { name: 'B', role: 'main' },
        { name: 'C', role: 'guest' }
      ])
    ).toBe('A & B (feat. C)')
  })
})
