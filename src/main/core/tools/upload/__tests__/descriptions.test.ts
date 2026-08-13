import { describe, expect, it } from 'vitest'
import {
  SPECTRAL_PLACEHOLDER,
  buildLossyMasterComment,
  formatDuration,
  generateAlbumDescription,
  generateReleaseDescription,
  generateSourceLinks,
  isMultiDisc,
  makeSpectralBbcode,
  providerLabelForUrl,
  spectralsPlaceholderBbcode,
  substituteSpectralBbcode,
  wrapTranscodeLossyComment
} from '../descriptions'

describe('description helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(65)).toBe('1:05')
    expect(formatDuration(0)).toBe('0:00')
  })

  it('detects multi-disc releases', () => {
    expect(isMultiDisc([{ discNumber: '1', trackNumber: '1', durationSeconds: 1 }])).toBe(false)
    expect(isMultiDisc([{ discNumber: '2', trackNumber: '1', durationSeconds: 1 }])).toBe(true)
  })

  it('treats "n of total" disc tags on a single disc as single-disc', () => {
    // "1/1" and a zero-padded "01" both mean disc one; only a disc above 1 counts.
    expect(isMultiDisc([{ discNumber: '1/1', trackNumber: '1', durationSeconds: 1 }])).toBe(false)
    expect(isMultiDisc([{ discNumber: '01', trackNumber: '1', durationSeconds: 1 }])).toBe(false)
    expect(isMultiDisc([{ discNumber: '02', trackNumber: '1', durationSeconds: 1 }])).toBe(true)
  })

  it('labels known provider URLs', () => {
    expect(providerLabelForUrl('https://www.discogs.com/release/1')).toBe('Discogs')
    expect(providerLabelForUrl('https://example.com/x')).toBe('example.com')
  })
})

describe('generateAlbumDescription', () => {
  it('only lists main artists in the album heading', () => {
    const artists = [
      { name: 'Disiz', role: 'main' },
      { name: 'Eloquence', role: 'guest' },
      { name: 'Bilal', role: 'guest' }
    ]
    const track = {
      trackNumber: '1',
      title: 'Le Réveil',
      artists,
      durationSeconds: 289
    }

    const peachfuzz = generateAlbumDescription([track], {
      artists,
      title: 'Jeu de société'
    })
    expect(peachfuzz).toContain('[b][artist]Disiz[/artist] - Jeu de société[/b]')
    expect(peachfuzz).not.toContain('[artist]Disiz[/artist] & [artist]Eloquence[/artist]')
    expect(peachfuzz).toContain(
      'Le Réveil (feat. [artist]Eloquence[/artist], [artist]Bilal[/artist])'
    )

    const bbcode = generateAlbumDescription([track], {
      artists,
      title: 'Jeu de société',
      templateId: 'bbcode'
    })
    expect(bbcode).toContain('[b]Disiz[/b] - [b]Jeu de société[/b]')
    expect(bbcode).not.toContain('[b]Disiz, Eloquence, Bilal[/b]')
  })

  it('renders peachfuzz by default', () => {
    const desc = generateAlbumDescription(
      [
        {
          trackNumber: '1',
          title: 'Intro',
          artists: [{ name: 'Artist', role: 'main' }],
          durationSeconds: 90
        },
        {
          trackNumber: '2',
          title: 'Outro',
          artists: [{ name: 'Artist', role: 'main' }],
          durationSeconds: 30
        }
      ],
      {
        artists: [{ name: 'Artist', role: 'main' }],
        title: 'Demo Album',
        year: '2024',
        urls: ['https://musicbrainz.org/release/abc'],
        sourceUrl: 'https://musicbrainz.org/release/abc'
      }
    )
    expect(desc).toContain('[b][artist]Artist[/artist] - Demo Album[/b]')
    expect(desc).toContain('\n2024\n')
    expect(desc).toContain('[b]01.[/b] Intro [i](1:30)[/i]')
    expect(desc).toContain('[b]02.[/b] Outro [i](0:30)[/i]')
    expect(desc).not.toContain('Artist - Intro')
    expect(desc).toContain(
      '[url=https://musicbrainz.org/release/abc]MusicBrainz[/url]'
    )
  })

  it('appends guest artists as feat. bbcode on track titles', () => {
    const desc = generateAlbumDescription(
      [
        {
          trackNumber: '7',
          title: 'PARACHUTE CHANEL',
          artists: [
            { name: 'Alpha Wann', role: 'main' },
            { name: 'Sneazzy', role: 'guest' }
          ],
          durationSeconds: 240
        },
        {
          trackNumber: '5',
          title: 'LE TOUR',
          artists: [
            { name: 'Alpha Wann', role: 'main' },
            { name: "Infinit'", role: 'guest' }
          ],
          durationSeconds: 174
        }
      ],
      {
        templateId: 'bbcode',
        artists: [{ name: 'Alpha Wann', role: 'main' }],
        title: 'Album',
        sourceUrl: 'https://www.discogs.com/release/1'
      }
    )
    expect(desc).toContain(
      "[b]07.[/b] PARACHUTE CHANEL (feat. [artist]Sneazzy[/artist]) [i](4:00)[/i]"
    )
    expect(desc).toContain(
      "[b]05.[/b] LE TOUR (feat. [artist]Infinit'[/artist]) [i](2:54)[/i]"
    )
    expect(desc).not.toContain('Alpha Wann -')
    expect(desc).not.toContain('Alpha Wann,')
  })

  it('renders bbcode standard when selected', () => {
    const desc = generateAlbumDescription(
      [
        {
          trackNumber: '1',
          title: 'Intro',
          artists: [{ name: 'Artist', role: 'main' }],
          durationSeconds: 90
        }
      ],
      {
        templateId: 'bbcode',
        artists: [{ name: 'Artist', role: 'main' }],
        title: 'Demo Album',
        year: '2024',
        label: 'Warp',
        catNo: 'WAP1',
        genres: ['Electronic'],
        formats: 'WEB',
        sourceUrl: 'https://www.discogs.com/release/1'
      }
    )
    expect(desc).toContain('[b]Artist[/b] - [b]Demo Album[/b] (2024)')
    expect(desc).toContain('[b]Label:[/b] Warp — WAP1')
    expect(desc).toContain('[b]Format:[/b] WEB')
    expect(desc).toContain('[b]Genre:[/b] Electronic')
    expect(desc).toContain('[b]Tracklist:[/b]')
    expect(desc).toContain('[b]01.[/b] Intro [i](1:30)[/i]')
  })
})

describe('generateReleaseDescription', () => {
  it('includes spectrals placeholder, encode specifics, and footer', () => {
    const desc = generateReleaseDescription({
      bitDepth: 16,
      sampleRate: 44100,
      sourceUrl: 'https://www.discogs.com/release/1',
      metadataUrls: ['https://musicbrainz.org/release/abc', 'https://www.discogs.com/release/1'],
      version: '0.1.0'
    })
    expect(desc.startsWith(spectralsPlaceholderBbcode())).toBe(true)
    expect(desc).toContain('Encode Specifics:')
    expect(desc).toContain('16 bit')
    expect(desc).toContain('[b]Source:[/b] [url=https://www.discogs.com/release/1]Discogs[/url]')
    expect(desc).toContain('[b]More info:[/b] [url=https://musicbrainz.org/release/abc]MusicBrainz[/url]')
    expect(desc).toContain('[hr]Uploaded with [b]gravlax[/b] v0.1.0')
  })

  it('adds lossy notes when flagged', () => {
    const desc = generateReleaseDescription({
      lossyMaster: true,
      lossyComment: 'Soft clipped',
      version: '0.1.0'
    })
    expect(desc).toContain('[u]Lossy Notes:[/u]')
    expect(desc).toContain('Soft clipped')
    expect(desc).toContain('[hr]Uploaded with [b]gravlax[/b] v0.1.0')
  })
})

describe('generateSourceLinks', () => {
  it('excludes the source URL', () => {
    expect(
      generateSourceLinks(
        ['https://www.discogs.com/release/1', 'https://musicbrainz.org/release/abc'],
        'https://www.discogs.com/release/1'
      )
    ).toBe('[url=https://musicbrainz.org/release/abc]MusicBrainz[/url]')
  })
})

describe('makeSpectralBbcode', () => {
  it('renders a full and zoomed image per track', () => {
    expect(
      makeSpectralBbcode([
        { filename: '01 One.flac', fullUrl: 'https://i/1f.png', zoomUrl: 'https://i/1z.png' },
        { filename: '02 Two.flac', fullUrl: 'https://i/2f.png', zoomUrl: 'https://i/2z.png' }
      ])
    ).toBe(
      '[hide=Spectrals]' +
        '[b]01 One.flac Full[/b]\n[img=https://i/1f.png]\n[hide=Zoomed][img=https://i/1z.png][/hide]\n\n' +
        '[b]02 Two.flac Full[/b]\n[img=https://i/2f.png]\n[hide=Zoomed][img=https://i/2z.png][/hide]\n\n' +
        '[/hide]\n'
    )
  })

  it('replaces brackets in filenames so the hide tag survives', () => {
    const bbcode = makeSpectralBbcode([
      { filename: '01 [Bonus].flac', fullUrl: 'https://i/f.png', zoomUrl: 'https://i/z.png' }
    ])
    expect(bbcode).toContain('[b]01 _Bonus_.flac Full[/b]')
  })

  it('returns nothing for an empty selection', () => {
    expect(makeSpectralBbcode([])).toBe('')
  })
})

describe('substituteSpectralBbcode', () => {
  const bbcode = '[hide=Spectrals][b]x[/b][/hide]\n'

  it('replaces the placeholder', () => {
    const desc = `${SPECTRAL_PLACEHOLDER}Encode Specifics: 16 bit\n`
    expect(substituteSpectralBbcode(desc, bbcode)).toBe(`${bbcode}Encode Specifics: 16 bit\n`)
  })

  it('removes the placeholder when nothing was hosted', () => {
    const desc = `${SPECTRAL_PLACEHOLDER}Encode Specifics: 16 bit\n`
    expect(substituteSpectralBbcode(desc, '')).toBe('Encode Specifics: 16 bit\n')
  })

  it('leaves a description the user stripped the placeholder from alone', () => {
    const desc = 'Encode Specifics: 16 bit\n'
    expect(substituteSpectralBbcode(desc, bbcode)).toBe(desc)
  })

  it('is what generateReleaseDescription emits', () => {
    const desc = generateReleaseDescription({
      bitDepth: 16,
      sampleRate: 44100,
      version: '0.1.0'
    })
    expect(substituteSpectralBbcode(desc, bbcode).startsWith(bbcode)).toBe(true)
  })
})

describe('buildLossyMasterComment', () => {
  it('joins the user comment and spectrals', () => {
    expect(
      buildLossyMasterComment({
        comment: 'Sourced from Bandcamp',
        spectralBbcode: '[hide=Spectrals]x[/hide]\n'
      })
    ).toBe('Sourced from Bandcamp\n\n[hide=Spectrals]x[/hide]\n')
  })

  it('omits empty sections', () => {
    expect(buildLossyMasterComment({ spectralBbcode: '[hide=Spectrals]x[/hide]\n' })).toBe(
      '[hide=Spectrals]x[/hide]\n'
    )
    expect(buildLossyMasterComment({})).toBe('')
  })
})

describe('wrapTranscodeLossyComment', () => {
  it('folds the original comment away behind the source link', () => {
    expect(wrapTranscodeLossyComment('https://red/torrents.php?id=1', 'Soft clipped')).toBe(
      'Transcode of https://red/torrents.php?id=1\n' +
        '[hide=Lossy comment of original torrent]Soft clipped[/hide]\n'
    )
  })

  it('drops the hide block when there is no comment', () => {
    expect(wrapTranscodeLossyComment('https://red/torrents.php?id=1', '  ')).toBe(
      'Transcode of https://red/torrents.php?id=1\n'
    )
  })
})
