import { describe, expect, it } from 'vitest'
import {
  buildDupeSearchStrings,
  buildQueryStrings,
  cleanReleaseTitle,
  filterUnnecessarySearchstrs,
  groupSearchFingerprint,
  normalizeAccents,
  parseTorrentPageRef,
  sanitizeAlbumForDupeCheck
} from '../dupeSearch'

describe('cleanReleaseTitle', () => {
  it('strips feat and EP/Single markers', () => {
    expect(cleanReleaseTitle('Song (feat. Guest) - EP')).toBe('Song')
  })
})

describe('buildQueryStrings', () => {
  it('uses title only for VA / many artists', () => {
    expect(buildQueryStrings([], 'Album')).toEqual(['Album'])
  })

  it('joins single artist and title', () => {
    expect(buildQueryStrings(['Artist'], 'Album')).toEqual(['Artist Album'])
  })

  it('builds one string per artist for 2–3 mains', () => {
    expect(buildQueryStrings(['A', 'B'], 'Album')).toEqual(['A Album', 'B Album'])
  })
})

describe('sanitizeAlbumForDupeCheck', () => {
  it('strips edition parentheticals and normalizes remix markers', () => {
    expect(sanitizeAlbumForDupeCheck('Album (Deluxe Edition)')).toBe('Album')
    expect(sanitizeAlbumForDupeCheck('Album (Club Remix)')).toBe('Album remix')
  })
})

describe('buildDupeSearchStrings', () => {
  it('builds artist title search strings', () => {
    expect(
      buildDupeSearchStrings({
        artists: [{ name: 'Artist', importance: 1 }],
        title: 'Album'
      })
    ).toEqual(['Artist Album'])
  })

  it('expands vol abbreviation to volume', () => {
    const strings = buildDupeSearchStrings({
      artists: [{ name: 'Artist', importance: 1 }],
      title: 'Hits Vol.2'
    })
    expect(strings.some((s) => /volume/i.test(s))).toBe(true)
  })

  it('searches catno for untitled albums', () => {
    const strings = buildDupeSearchStrings({
      artists: [{ name: 'Artist', importance: 1 }],
      title: 'Untitled',
      catalogueNumber: 'CAT001'
    })
    expect(strings).toContain('Artist CAT001')
  })

  it('searches first segment of slash titles', () => {
    const strings = buildDupeSearchStrings({
      artists: [{ name: 'Artist', importance: 1 }],
      title: 'A-Side / B-Side'
    })
    expect(strings.some((s) => s.includes('A-Side') && !s.includes('B-Side'))).toBe(true)
  })

  it('searches untitled when catno is embedded in title', () => {
    const strings = buildDupeSearchStrings({
      artists: [{ name: 'Artist', importance: 1 }],
      title: 'Release CAT001',
      catalogueNumber: 'CAT001'
    })
    expect(strings).toContain('Artist untitled')
  })

  it('normalizes accents', () => {
    const strings = buildDupeSearchStrings({
      artists: [{ name: 'Beyoncé', importance: 1 }],
      title: 'Album'
    })
    expect(strings[0]).toBe('Beyonce Album')
  })
})

describe('filterUnnecessarySearchstrs', () => {
  it('drops strings whose words are already covered by a shorter query', () => {
    expect(filterUnnecessarySearchstrs(['a b', 'a b c', 'x'])).toEqual(['x', 'a b'])
  })
})

describe('normalizeAccents', () => {
  it('strips combining marks', () => {
    expect(normalizeAccents('café')).toBe('cafe')
  })
})

describe('groupSearchFingerprint', () => {
  it('changes when trackers or title change', () => {
    const base = groupSearchFingerprint({
      artists: [{ name: 'A', importance: 1 }],
      title: 'T',
      trackerIds: ['redacted']
    })
    expect(
      groupSearchFingerprint({
        artists: [{ name: 'A', importance: 1 }],
        title: 'T2',
        trackerIds: ['redacted']
      })
    ).not.toBe(base)
    expect(
      groupSearchFingerprint({
        artists: [{ name: 'A', importance: 1 }],
        title: 'T',
        trackerIds: ['orpheus']
      })
    ).not.toBe(base)
  })
})

describe('parseTorrentPageRef', () => {
  it('parses bare group ids', () => {
    expect(parseTorrentPageRef('42')).toEqual({ groupId: 42 })
  })

  it('parses group and torrent urls', () => {
    expect(parseTorrentPageRef('https://redacted.ch/torrents.php?id=99')).toEqual({ groupId: 99 })
    expect(parseTorrentPageRef('https://redacted.ch/torrents.php?torrentid=7')).toEqual({
      torrentId: 7
    })
  })

  it('returns null for junk', () => {
    expect(parseTorrentPageRef('not-a-url')).toBeNull()
  })
})
