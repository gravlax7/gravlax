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
})

async function writeTestFlac(comments: string[], pictureCount: number): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'gravlax-tags-'))
  temporaryPaths.push(directory)
  const path = join(directory, 'track.flac')
  const blocks = [metadataBlock(4, vorbisComments(comments), pictureCount === 0)]
  for (let index = 0; index < pictureCount; index++) {
    blocks.push(metadataBlock(6, Buffer.from([index]), index === pictureCount - 1))
  }
  await writeFile(path, Buffer.concat([Buffer.from('fLaC'), ...blocks]))
  return path
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
