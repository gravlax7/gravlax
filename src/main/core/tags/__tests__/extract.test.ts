import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { extractAlbumReleaseWithEmbeddedCoverArt } from '../extract'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe('extractAlbumReleaseWithEmbeddedCoverArt', () => {
  it('reports no embedded cover art when the FLAC has none', async () => {
    const path = await writeTestFlac(['ALBUM=No Art'], 0)

    const result = await extractAlbumReleaseWithEmbeddedCoverArt(path)

    expect(result.release.title).toBe('No Art')
    expect(result.embeddedCoverArtCount).toBe(0)
  })

  it('counts picture blocks and legacy COVERART values', async () => {
    const path = await writeTestFlac(['ALBUM=With Art', 'COVERART=base64-value'], 2)

    const result = await extractAlbumReleaseWithEmbeddedCoverArt(path)

    expect(result.release.title).toBe('With Art')
    expect(result.embeddedCoverArtCount).toBe(3)
  })

  it('unions mixed genres across a multi-disc album', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'gravlax-tags-'))
    temporaryPaths.push(directory)
    await writeFlac(join(directory, 'cd1.flac'), ['ALBUM=Box', 'DISCNUMBER=1', 'GENRE=Electronic'])
    await writeFlac(join(directory, 'cd2.flac'), ['ALBUM=Box', 'DISCNUMBER=2', 'GENRE=Ambient'])

    const result = await extractAlbumReleaseWithEmbeddedCoverArt(directory)

    expect(result.release.genres).toEqual(['Electronic', 'Ambient'])
    expect(result.release.mixed?.genres).toBe(true)
  })

  it('reads composer and conductor comments without splitting names on separators', async () => {
    const path = await writeTestFlac([
      'ALBUM=Classics',
      'ALBUMARTIST=Orchestra',
      'ARTIST=Orchestra',
      'COMPOSER=Bach, Johann Sebastian',
      'COMPOSER=Earth, Wind & Fire',
      'COMPOSER=Writer One; Writer Two / Writer Three',
      'CONDUCTOR=Maestro'
    ], 0)

    const result = await extractAlbumReleaseWithEmbeddedCoverArt(path)

    expect(result.release.tracks?.[0]?.artists).toEqual([
      { name: 'Orchestra', role: 'main' },
      { name: 'Bach, Johann Sebastian', role: 'composer' },
      { name: 'Earth, Wind & Fire', role: 'composer' },
      { name: 'Writer One; Writer Two / Writer Three', role: 'composer' },
      { name: 'Maestro', role: 'conductor' }
    ])
    expect(result.release.artists).toContainEqual({
      name: 'Bach, Johann Sebastian',
      role: 'composer'
    })
    expect(result.release.artists).toContainEqual({ name: 'Maestro', role: 'conductor' })
  })

  it('drops a conductor main duplicate when another main remains', async () => {
    const path = await writeTestFlac([
      'ARTIST=Orchestra',
      'ARTIST=Maestro',
      'CONDUCTOR=Maestro'
    ], 0)

    const result = await extractAlbumReleaseWithEmbeddedCoverArt(path)

    expect(result.release.tracks?.[0]?.artists).toEqual([
      { name: 'Orchestra', role: 'main' },
      { name: 'Maestro', role: 'conductor' }
    ])
  })

  it('keeps main and composer roles for a songwriter collision', async () => {
    const path = await writeTestFlac(['ARTIST=Adele', 'COMPOSER=Adele'], 0)

    const result = await extractAlbumReleaseWithEmbeddedCoverArt(path)

    expect(result.release.tracks?.[0]?.artists).toEqual([
      { name: 'Adele', role: 'main' },
      { name: 'Adele', role: 'composer' }
    ])
  })

  it('keeps the last main when it is also the conductor', async () => {
    const path = await writeTestFlac(['ARTIST=Maestro', 'CONDUCTOR=Maestro'], 0)

    const result = await extractAlbumReleaseWithEmbeddedCoverArt(path)

    expect(result.release.tracks?.[0]?.artists).toEqual([
      { name: 'Maestro', role: 'main' },
      { name: 'Maestro', role: 'conductor' }
    ])
  })

  it('keeps album main and matching track composer as separate release credits', async () => {
    const path = await writeTestFlac([
      'ALBUMARTIST=Mozart',
      'ARTIST=Mozart',
      'COMPOSER=Mozart'
    ], 0)

    const result = await extractAlbumReleaseWithEmbeddedCoverArt(path)

    expect(result.release.artists).toEqual([
      { name: 'Mozart', role: 'main' },
      { name: 'Mozart', role: 'composer' }
    ])
  })

  it('marks track-only main artists as release guests when an album artist exists', async () => {
    const path = await writeTestFlac([
      'ALBUMARTIST=Various Artists',
      'ARTIST=Track Artist'
    ], 0)

    const result = await extractAlbumReleaseWithEmbeddedCoverArt(path)

    expect(result.release.artists).toEqual([
      { name: 'Various Artists', role: 'main' },
      { name: 'Track Artist', role: 'guest' }
    ])
  })

  it('keeps original and edition dates and falls back to DATE', async () => {
    const withBoth = await extractAlbumReleaseWithEmbeddedCoverArt(
      await writeTestFlac(['ORIGINALDATE=2018-09-21', 'DATE=2020-05'], 0)
    )
    expect(withBoth.release.groupYear).toBe('2018-09-21')
    expect(withBoth.release.year).toBe('2020-05')

    const dateOnly = await extractAlbumReleaseWithEmbeddedCoverArt(
      await writeTestFlac(['DATE=2019-01-02'], 0)
    )
    expect(dateOnly.release.groupYear).toBe('2019-01-02')
    expect(dateOnly.release.year).toBe('2019-01-02')

    const yearAlias = await extractAlbumReleaseWithEmbeddedCoverArt(
      await writeTestFlac(['YEAR=2011'], 0)
    )
    expect(yearAlias.release.year).toBe('2011')
    expect(yearAlias.release.groupYear).toBe('2011')
  })

  it('prefers ALBUMARTISTS over the joined ALBUMARTIST tag', async () => {
    const result = await extractAlbumReleaseWithEmbeddedCoverArt(
      await writeTestFlac(['ALBUMARTISTS=Named', 'ALBUMARTIST=Named, Extra'], 0)
    )
    expect(result.release.artists).toEqual([{ name: 'Named', role: 'main' }])
  })

  it('keeps parentheticals in ALBUM and reads EDITIONTITLE when present', async () => {
    const fromAlbum = await extractAlbumReleaseWithEmbeddedCoverArt(
      await writeTestFlac(['ALBUM=Rounds (Deluxe Edition)'], 0)
    )
    expect(fromAlbum.release.title).toBe('Rounds (Deluxe Edition)')
    expect(fromAlbum.release.editionTitle).toBe('')

    const tagged = await extractAlbumReleaseWithEmbeddedCoverArt(
      await writeTestFlac(['ALBUM=Rounds', 'EDITIONTITLE=Reissue'], 0)
    )
    expect(tagged.release.title).toBe('Rounds')
    expect(tagged.release.editionTitle).toBe('Reissue')
  })

  it('reads companion artists, extra roles, barcodes, and release type', async () => {
    const result = await extractAlbumReleaseWithEmbeddedCoverArt(
      await writeTestFlac([
        'ALBUM=Album',
        'ARTISTS=Main',
        'ARTIST=Main, Maestro (feat. Guest)',
        'COMPOSER=Writer',
        'CONDUCTOR=Maestro',
        'REMIXER=Remixer',
        'PRODUCER=Producer',
        'ARRANGER=Arranger',
        'BARCODE=012345678901',
        'RELEASETYPE=Album',
        'URL=https://example.invalid/release'
      ], 0)
    )

    expect(result.release.upc).toBe('012345678901')
    expect(result.release.releaseType).toBe('Album')
    expect(result.release.urls).toEqual(['https://example.invalid/release'])
    expect(result.release.tracks?.[0]?.artists).toEqual([
      { name: 'Main', role: 'main' },
      { name: 'Writer', role: 'composer' },
      { name: 'Maestro', role: 'conductor' },
      { name: 'Remixer', role: 'remixer' },
      { name: 'Producer', role: 'producer' },
      { name: 'Arranger', role: 'arranger' }
    ])
  })
})

async function writeTestFlac(comments: string[], pictureCount: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gravlax-tags-'))
  temporaryPaths.push(directory)
  const path = join(directory, 'track.flac')
  await writeFlac(path, comments, pictureCount)
  return path
}

async function writeFlac(
  path: string,
  comments: string[],
  pictureCount = 0
): Promise<void> {
  const blocks = [metadataBlock(4, vorbisComments(comments), pictureCount === 0)]
  for (let index = 0; index < pictureCount; index++) {
    blocks.push(metadataBlock(6, Buffer.from([index]), index === pictureCount - 1))
  }
  await writeFile(path, Buffer.concat([Buffer.from('fLaC'), ...blocks]))
}

function metadataBlock(type: number, payload: Buffer, last: boolean): Buffer {
  const header = Buffer.alloc(4)
  header[0] = type | (last ? 0x80 : 0)
  header.writeUIntBE(payload.length, 1, 3)
  return Buffer.concat([header, payload])
}

function vorbisComments(comments: string[]): Buffer {
  const vendor = Buffer.from('test')
  const parts = [littleEndian(vendor.length), vendor, littleEndian(comments.length)]
  for (const comment of comments) {
    const bytes = Buffer.from(comment)
    parts.push(littleEndian(bytes.length), bytes)
  }
  return Buffer.concat(parts)
}

function littleEndian(value: number): Buffer {
  const bytes = Buffer.alloc(4)
  bytes.writeUInt32LE(value)
  return bytes
}
