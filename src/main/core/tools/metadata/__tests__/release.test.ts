import { describe, expect, it } from 'vitest'
import { formatArtists } from '@shared/tags/editor'
import { createDeezerProvider } from '../deezer'
import { createMusicBrainzProvider } from '../musicbrainz'
import { finalizeNormalizedRelease } from '../normalization'

const deezer = createDeezerProvider(5000)
const musicBrainz = createMusicBrainzProvider(5000)

function normalizeProviderRelease(
  raw: Record<string, unknown>,
  provider: string,
  url: string
) {
  const mapped =
    provider === 'MusicBrainz'
      ? musicBrainz.mapRelease(raw, url)
      : deezer.mapRelease(raw, url)
  return finalizeNormalizedRelease(mapped)
}

describe('normalizeProviderRelease artists', () => {
  it('unwraps Deezer single artist objects and contributor roles', () => {
    const release = normalizeProviderRelease(
      {
        title: 'There Is Love In You',
        artist: { id: 27, name: 'Four Tet' },
        contributors: [
          { id: 27, name: 'Four Tet', role: 'Main' },
          { id: 99, name: 'Burial', role: 'Featured' }
        ],
        tracklist: [
          {
            title: 'Angel Echoes',
            artist: { id: 27, name: 'Four Tet' }
          }
        ]
      },
      'Deezer',
      'https://www.deezer.com/album/99'
    )

    expect(release.artists).toEqual([
      { name: 'Four Tet', role: 'main' },
      { name: 'Burial', role: 'guest' }
    ])
    expect(release.albumArtist).toBe('Four Tet')
    expect(formatArtists(release.artists ?? [])).toEqual([
      'Four Tet [main]',
      'Burial [guest]'
    ])
    expect(release.tracks?.[0]?.artists).toEqual([{ name: 'Four Tet', role: 'main' }])
  })

  it('falls back to a single artist object when contributors are absent', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        artist: { name: 'Four Tet' }
      },
      'Deezer',
      ''
    )

    expect(release.artists).toEqual([{ name: 'Four Tet', role: 'main' }])
    expect(release.albumArtist).toBe('Four Tet')
  })

  it('keeps MusicBrainz artist-credit arrays working', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        'artist-credit': [
          { name: 'Four Tet', joinphrase: ' & ', artist: { name: 'Four Tet' } },
          { name: 'Burial', artist: { name: 'Burial' } }
        ]
      },
      'MusicBrainz',
      ''
    )

    expect(release.artists).toEqual([
      { name: 'Four Tet', role: 'main' },
      { name: 'Burial', role: 'main' }
    ])
  })

  it('reads MusicBrainz label-info for label and catalog number', () => {
    const release = normalizeProviderRelease(
      {
        title: "UNE MAIN LAVE L'AUTRE",
        barcode: '602567971092',
        date: '2018-09-21',
        'release-group': {
          'primary-type': 'Album',
          'first-release-date': '2018-09-21'
        },
        'label-info': [
          {
            'catalog-number': '6797109',
            label: { name: 'Don Dada Records', id: '2e4930df-d8ee-4704-bbd0-79d9881ce7e7' }
          }
        ],
        media: [
          {
            position: 1,
            tracks: Array.from({ length: 17 }, (_, i) => ({
              number: String(i + 1),
              position: i + 1,
              title: `Track ${i + 1}`,
              recording: { title: `Track ${i + 1}`, 'artist-credit': [{ name: 'Alpha Wann' }] }
            }))
          }
        ]
      },
      'MusicBrainz',
      'https://musicbrainz.org/release/88e95ea5-b609-4f8b-b0cb-69896eef2f47'
    )

    expect(release.label).toBe('Don Dada Records')
    expect(release.catNo).toBe('6797109')
    expect(release.upc).toBe('602567971092')
    expect(release.releaseType).toBe('Album')
    expect(release.year).toBe('2018')
    expect(release.groupYear).toBe('2018')
    expect(release.tracks).toHaveLength(17)
    expect(release.tracks?.[0]?.trackNumber).toBe('1')
  })

  it('extracts Deezer cover_xl as cover', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        artist: { name: 'Four Tet' },
        cover_xl: 'https://e-cdns-images.dzcdn.net/images/cover/abc/1000x1000-000000-100-0-0.jpg'
      },
      'Deezer',
      'https://www.deezer.com/album/99'
    )
    expect(release.cover).toBe(
      'https://e-cdns-images.dzcdn.net/images/cover/abc/1000x1000-000000-100-0-0.jpg'
    )
  })

  it('extracts MusicBrainz cover-art-archive front URL', () => {
    const id = '88e95ea5-b609-4f8b-b0cb-69896eef2f47'
    const release = normalizeProviderRelease(
      {
        id,
        title: 'Album',
        'cover-art-archive': { front: true, back: false, count: 1 }
      },
      'MusicBrainz',
      `https://musicbrainz.org/release/${id}`
    )
    expect(release.cover).toBe(`https://coverartarchive.org/release/${id}/front`)
  })

  it('omits MusicBrainz cover when cover-art-archive has no front', () => {
    const release = normalizeProviderRelease(
      {
        id: '88e95ea5-b609-4f8b-b0cb-69896eef2f47',
        title: 'Album',
        'cover-art-archive': { front: false, count: 0 }
      },
      'MusicBrainz',
      ''
    )
    expect(release.cover).toBeUndefined()
  })

  it('prefers MusicBrainz release-group secondary types and first-release-date', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Live In Paris',
        date: '2020-01-01',
        'release-group': {
          'primary-type': 'Album',
          'secondary-types': ['Live'],
          'first-release-date': '2019-05-01'
        },
        media: [
          {
            position: 1,
            tracks: Array.from({ length: 10 }, (_, i) => ({
              number: String(i + 1),
              title: `Song ${i + 1}`,
              recording: { title: `Song ${i + 1}` }
            }))
          }
        ]
      },
      'MusicBrainz',
      ''
    )

    expect(release.releaseType).toBe('Live Album')
    expect(release.year).toBe('2020')
    expect(release.groupYear).toBe('2019')
  })

  it('drops none catalog numbers and catnos that duplicate upc', () => {
    expect(
      normalizeProviderRelease(
        {
          title: 'Album',
          barcode: '123',
          'label-info': [{ 'catalog-number': 'none', label: { name: 'Label' } }]
        },
        'MusicBrainz',
        ''
      ).catNo
    ).toBe('')

    expect(
      normalizeProviderRelease(
        {
          title: 'Album',
          barcode: '602567971092',
          'label-info': [{ 'catalog-number': '602567971092', label: { name: 'Label' } }]
        },
        'MusicBrainz',
        ''
      ).catNo
    ).toBe('')
  })

  it('parses Deezer public album genres, record type, and tracks.data', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Have Love Will Travel (feat. Someone)',
        label: '2018 Audio Processing Records',
        upc: '5057272123895',
        record_type: 'single',
        release_date: '2018-06-07',
        genres: {
          data: [
            { id: 165, name: 'R&B' },
            { id: 536, name: 'Soul' }
          ]
        },
        artist: { name: 'Mr. 69' },
        tracks: {
          data: [
            {
              title: 'Have Love Will Travel',
              artist: { name: 'Mr. 69' }
            }
          ]
        }
      },
      'Deezer',
      'https://www.deezer.com/album/65403272'
    )

    expect(release.title).toBe('Have Love Will Travel')
    expect(release.label).toBe('Audio Processing Records')
    expect(release.releaseType).toBe('Single')
    expect(release.genres).toEqual(['R&B', 'Soul'])
    expect(release.tracks).toHaveLength(1)
    expect(release.tracks?.[0]?.title).toBe('Have Love Will Travel')
    expect(release.tracks?.[0]?.artists).toEqual([{ name: 'Mr. 69', role: 'main' }])
  })

  it('parses Deezer internal tracklist fields', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        record_type: 'album',
        artist: { name: 'Alpha Wann' },
        tracklist: [
          {
            SNG_TITLE: 'PARACHUTE CHANEL',
            VERSION: '',
            DISK_NUMBER: '1',
            TRACK_NUMBER: '3',
            SNG_CONTRIBUTORS: {
              mainartist: ['Alpha Wann'],
              featuredartist: ['Sneazzy']
            },
            ARTISTS: [{ ART_NAME: 'Alpha Wann' }]
          },
          {
            SNG_TITLE: 'Song',
            VERSION: 'Remix',
            DISK_NUMBER: '2',
            TRACK_NUMBER: '1',
            SNG_CONTRIBUTORS: { mainartist: ['Alpha Wann'] },
            ARTISTS: [{ ART_NAME: 'Alpha Wann' }]
          }
        ]
      },
      'Deezer',
      ''
    )

    expect(release.tracks).toHaveLength(2)
    expect(release.tracks?.[0]).toMatchObject({
      title: 'PARACHUTE CHANEL',
      discNumber: '1',
      trackNumber: '3'
    })
    expect(release.tracks?.[0]?.artists).toEqual([
      { name: 'Alpha Wann', role: 'main' },
      { name: 'Sneazzy', role: 'guest' }
    ])
    expect(release.tracks?.[1]).toMatchObject({
      title: 'Song (Remix)',
      discNumber: '2',
      trackNumber: '1'
    })
  })

  it('marks Deezer labels matching the main artist as Self-Released', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        label: 'Four Tet',
        artist: { name: 'Four Tet' },
        record_type: 'album',
        tracklist: Array.from({ length: 10 }, (_, i) => ({
          title: `Track ${i + 1}`,
          artist: { name: 'Four Tet' }
        }))
      },
      'Deezer',
      ''
    )

    expect(release.label).toBe('Self-Released')
    expect(release.releaseType).toBe('Album')
  })

  it('keeps plain artists arrays working', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        artists: [{ name: 'Four Tet' }, { name: 'Burial' }]
      },
      'Deezer',
      ''
    )

    expect(release.artists).toEqual([
      { name: 'Four Tet', role: 'main' },
      { name: 'Burial', role: 'main' }
    ])
  })

  it('marks MusicBrainz featured track artists as guests from joinphrases', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        'artist-credit': [{ name: 'Four Tet', artist: { name: 'Four Tet' } }],
        media: [
          {
            position: 1,
            tracks: [
              {
                number: '1',
                title: 'Angel Echoes',
                'artist-credit': [
                  { name: 'Four Tet', joinphrase: ' feat. ', artist: { name: 'Four Tet' } },
                  { name: 'Burial', artist: { name: 'Burial' } }
                ]
              }
            ]
          }
        ]
      },
      'MusicBrainz',
      ''
    )

    expect(release.tracks?.[0]?.artists).toEqual([
      { name: 'Four Tet', role: 'main' },
      { name: 'Burial', role: 'guest' }
    ])
  })

  it('adds featured artists from track titles as guests', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        artists: [{ name: 'Alpha Wann' }],
        tracklist: [
          {
            title: 'PARACHUTE CHANEL (feat. Sneazzy)',
            artist: { name: 'Alpha Wann' }
          }
        ]
      },
      'Deezer',
      ''
    )

    expect(release.tracks?.[0]?.artists).toEqual([
      { name: 'Alpha Wann', role: 'main' },
      { name: 'Sneazzy', role: 'guest' }
    ])
    expect(release.tracks?.[0]?.title).toBe('PARACHUTE CHANEL')
  })

  it('merges track artists into the release artists field', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        artists: [{ name: 'Alpha Wann', role: 'main' }],
        tracklist: [
          {
            title: 'PARACHUTE CHANEL (feat. Sneazzy)',
            artist: { name: 'Alpha Wann' }
          },
          {
            title: 'Other',
            artists: [
              { name: 'Alpha Wann', role: 'main' },
              { name: 'Kekra', role: 'guest' }
            ]
          }
        ]
      },
      'Deezer',
      ''
    )

    expect(release.artists).toEqual([
      { name: 'Alpha Wann', role: 'main' },
      { name: 'Sneazzy', role: 'guest' },
      { name: 'Kekra', role: 'guest' }
    ])
    expect(release.albumArtist).toBe('Alpha Wann')
  })

  it('marks track-only main artists as release guests', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Nique le Casino 2',
        'artist-credit': [{ name: 'Sadek', artist: { name: 'Sadek' } }],
        media: [
          {
            position: 1,
            tracks: [
              {
                number: '7',
                title: 'Champions',
                'artist-credit': [
                  { name: 'Sadek', joinphrase: ', ', artist: { name: 'Sadek' } },
                  { name: "Limsa d'Aulnay", artist: { name: "Limsa d'Aulnay" } }
                ]
              },
              {
                number: '12',
                title: 'La balade du repenti',
                'artist-credit': [
                  { name: 'Sadek', joinphrase: ', ', artist: { name: 'Sadek' } },
                  { name: 'winnterzuko', artist: { name: 'winnterzuko' } }
                ]
              },
              {
                number: '14',
                title: 'Changer',
                'artist-credit': [
                  { name: 'Sadek', joinphrase: ', ', artist: { name: 'Sadek' } },
                  { name: 'Josman', artist: { name: 'Josman' } }
                ]
              }
            ]
          }
        ]
      },
      'MusicBrainz',
      ''
    )

    expect(release.artists).toEqual([
      { name: 'Sadek', role: 'main' },
      { name: "Limsa d'Aulnay", role: 'guest' },
      { name: 'winnterzuko', role: 'guest' },
      { name: 'Josman', role: 'guest' }
    ])
    expect(release.tracks?.[0]?.artists).toEqual([
      { name: 'Sadek', role: 'main' },
      { name: "Limsa d'Aulnay", role: 'main' }
    ])
  })

  it('marks Deezer track-only main artists as release guests', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Nique le Casino 2',
        artist: { name: 'Sadek' },
        tracklist: [
          {
            SNG_TITLE: 'Champions',
            SNG_CONTRIBUTORS: { mainartist: ['Sadek', "Limsa d'Aulnay"] },
            ARTISTS: [{ ART_NAME: 'Sadek' }, { ART_NAME: "Limsa d'Aulnay" }]
          }
        ]
      },
      'Deezer',
      ''
    )

    expect(release.artists).toEqual([
      { name: 'Sadek', role: 'main' },
      { name: "Limsa d'Aulnay", role: 'guest' }
    ])
    expect(release.tracks?.[0]?.artists).toEqual([
      { name: 'Sadek', role: 'main' },
      { name: "Limsa d'Aulnay", role: 'main' }
    ])
  })

  it('keeps every release-credited artist main', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Split Album',
        artists: [
          { name: 'Artist A', role: 'main' },
          { name: 'Artist B', role: 'main' }
        ],
        tracklist: [
          { title: 'One', artist: { name: 'Artist A' } },
          { title: 'Two', artist: { name: 'Artist B' } }
        ]
      },
      'Deezer',
      ''
    )

    expect(release.artists).toEqual([
      { name: 'Artist A', role: 'main' },
      { name: 'Artist B', role: 'main' }
    ])
  })

  it('keeps track artists main when release credits are absent', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Compilation',
        tracklist: [
          { title: 'One', artist: { name: 'Artist A' } },
          { title: 'Two', artist: { name: 'Artist B' } }
        ]
      },
      'Deezer',
      ''
    )

    expect(release.artists).toEqual([
      { name: 'Artist A', role: 'main' },
      { name: 'Artist B', role: 'main' }
    ])
  })

  it('keeps an explicit release role when a track gives the artist another role', () => {
    const release = normalizeProviderRelease(
      {
        title: 'Album',
        artists: [
          { name: 'Artist A', role: 'main' },
          { name: 'Guest', role: 'guest' }
        ],
        tracklist: [
          {
            title: 'Song',
            artists: [
              { name: 'Artist A', role: 'main' },
              { name: 'Guest', role: 'main' }
            ]
          }
        ]
      },
      'Deezer',
      ''
    )

    expect(release.artists).toEqual([
      { name: 'Artist A', role: 'main' },
      { name: 'Guest', role: 'guest' }
    ])
  })
})
