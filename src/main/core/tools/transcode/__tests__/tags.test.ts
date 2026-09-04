import { describe, expect, it } from 'vitest'
import { id3TagsFromFlac, prepareTags } from '../tags'

describe('prepareTags', () => {
  it('strips replaygain and encoder tags', () => {
    const result = prepareTags({
      TITLE: ['Song'],
      REPLAYGAIN_TRACK_GAIN: ['-6.0 dB'],
      encoder: ['Lavf']
    })
    expect(result).toEqual({ title: ['Song'] })
  })

  it('merges track totals into tracknumber', () => {
    const result = prepareTags({
      tracknumber: ['3'],
      tracktotal: ['10']
    })
    expect(result.tracknumber).toEqual(['3/10'])
    expect(result.tracktotal).toBeUndefined()
  })

  it('merges disc totals with alternate key names', () => {
    const result = prepareTags({
      discnumber: ['1'],
      'total discs': ['2']
    })
    expect(result.discnumber).toEqual(['1/2'])
  })

  it('throws on conflicting totals', () => {
    expect(() =>
      prepareTags({
        tracknumber: ['1'],
        tracktotal: ['10'],
        totaltracks: ['12']
      })
    ).toThrow(/conflicting values/)
  })

  it('throws on non-integer totals', () => {
    expect(() =>
      prepareTags({
        tracknumber: ['1'],
        tracktotal: ['ten']
      })
    ).toThrow(/Non-integer total values/)
  })
})

describe('id3TagsFromFlac', () => {
  it('writes ID3v2.3 years, exact-date TXXX, native roles, and unknown comment language', () => {
    const id3 = id3TagsFromFlac(
      {
        title: ['Song'],
        album: ['Album'],
        artist: ['Artist'],
        albumartist: ['Artist'],
        albumartists: ['Artist'],
        date: ['2020-05-17'],
        originaldate: ['2018-09-21'],
        label: ['Label'],
        publisher: ['Source Publisher'],
        catalognumber: ['CAT-1'],
        composer: ['Writer'],
        conductor: ['Maestro'],
        remixer: ['Remixer'],
        producer: ['Producer'],
        djmixer: ['DJ'],
        arranger: ['Arranger'],
        tracknumber: ['1/10'],
        discnumber: ['1/2'],
        comment: ['Note'],
        releasetype: ['Album']
      },
      []
    )

    expect(id3.year).toBe('2020')
    expect(id3.originalYear).toBe('2018')
    expect(id3.publisher).toBe('Label')
    expect(id3.composer).toBe('Writer')
    expect(id3.conductor).toBe('Maestro')
    expect(id3.remixArtist).toBe('Remixer')
    expect(id3.trackNumber).toBe('1/10')
    expect(id3.partOfSet).toBe('1/2')
    expect(id3.comment).toEqual({ language: 'xxx', text: 'Note' })
    expect(id3.userDefinedText).toEqual([
      { description: 'ALBUMARTISTS', value: 'Artist' },
      { description: 'DATE', value: '2020-05-17' },
      { description: 'ORIGINALDATE', value: '2018-09-21' },
      { description: 'PUBLISHER', value: 'Source Publisher' },
      { description: 'CATALOGNUMBER', value: 'CAT-1' },
      { description: 'PRODUCER', value: 'Producer' },
      { description: 'DJMIXER', value: 'DJ' },
      { description: 'ARRANGER', value: 'Arranger' },
      { description: 'RELEASETYPE', value: 'Album' }
    ])
  })

  it('does not add exact-date TXXX when the value is only a year', () => {
    const id3 = id3TagsFromFlac({ date: ['2020'], originaldate: ['2018'] }, [])
    expect(id3.year).toBe('2020')
    expect(id3.originalYear).toBe('2018')
    expect(id3.userDefinedText).toBeUndefined()
  })

  it('uses PUBLISHER for the native frame when LABEL is absent', () => {
    const id3 = id3TagsFromFlac({ publisher: ['Publisher'] }, [])
    expect(id3.publisher).toBe('Publisher')
    expect(id3.userDefinedText).toBeUndefined()
  })
})
