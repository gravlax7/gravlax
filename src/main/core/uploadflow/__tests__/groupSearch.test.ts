import { describe, expect, it } from 'vitest'
import {
  mapBrowseResults,
  mapTorrentGroupDetail,
  suggestionKey
} from '../groupSearch'

describe('mapBrowseResults', () => {
  it('maps browse payload into suggestions and skips bad rows', () => {
    const results = mapBrowseResults('redacted', 'https://redacted.example/', {
      results: [
        {
          groupId: 10,
          artist: 'Artist &amp; Co',
          groupName: 'Album',
          groupYear: 2020,
          releaseType: 'Album',
          tags: ['rock', 'indie']
        },
        {
          groupId: 'bad'
        },
        {
          groupId: 11,
          artists: [{ name: 'A' }, { name: 'B' }],
          groupName: 'EP',
          releaseType: 5,
          tags: []
        }
      ]
    })

    expect(results).toEqual([
      {
        trackerId: 'redacted',
        groupId: 10,
        artist: 'Artist & Co',
        groupName: 'Album',
        year: 2020,
        releaseType: 'Album',
        tags: ['rock', 'indie'],
        url: 'https://redacted.example/torrents.php?id=10'
      },
      {
        trackerId: 'redacted',
        groupId: 11,
        artist: 'A & B',
        groupName: 'EP',
        year: undefined,
        releaseType: '5',
        tags: [],
        url: 'https://redacted.example/torrents.php?id=11'
      }
    ])
  })
})

describe('mapTorrentGroupDetail', () => {
  it('maps torrentgroup payload torrents', () => {
    const detail = mapTorrentGroupDetail('orpheus', 'https://orpheus.example', 5, {
      group: {
        name: 'Album',
        year: 2019,
        releaseType: 1,
        musicInfo: { artists: [{ name: 'Artist' }] }
      },
      torrents: [
        {
          media: 'WEB',
          format: 'FLAC',
          encoding: 'Lossless',
          remasterYear: 2019,
          remasterTitle: '',
          remasterRecordLabel: 'Label',
          remasterCatalogueNumber: 'CAT',
          size: 1024
        }
      ]
    })

    expect(detail.trackerId).toBe('orpheus')
    expect(detail.groupId).toBe(5)
    expect(detail.artist).toBe('Artist')
    expect(detail.groupName).toBe('Album')
    expect(detail.url).toBe('https://orpheus.example/torrents.php?id=5')
    expect(detail.torrents).toHaveLength(1)
    expect(detail.torrents[0]?.media).toBe('WEB')
    expect(detail.torrents[0]?.remasterRecordLabel).toBe('Label')
  })
})

describe('suggestionKey', () => {
  it('scopes by tracker and group id', () => {
    expect(
      suggestionKey({
        trackerId: 'redacted',
        groupId: 1,
        artist: '',
        groupName: '',
        tags: [],
        url: ''
      })
    ).toBe('redacted:1')
  })
})
