import { open } from 'node:fs/promises'
import NodeID3 from 'node-id3'
import { readFLACTags } from '@main/core/tags/extract'

const VORBIS_TO_ID3: Record<string, string> = {
  title: 'title',
  album: 'album',
  artist: 'artist',
  albumartist: 'performerInfo',
  'album artist': 'performerInfo',
  conductor: 'conductor',
  remixer: 'remixArtist',
  composer: 'composer',
  tracknumber: 'trackNumber',
  discnumber: 'partOfSet',
  date: 'year',
  comment: 'comment',
  genre: 'genre',
  language: 'language',
  key: 'initialKey',
  bpm: 'bpm',
  publisher: 'publisher',
  label: 'publisher',
  isrc: 'ISRC'
}

const TOT_MAP: Record<string, ReadonlySet<string>> = {
  tracknumber: new Set(['tracktotal', 'totaltracks', 'total tracks']),
  discnumber: new Set(['disctotal', 'totaldiscs', 'total discs'])
}

export interface FlacPicture {
  type: number
  mime: string
  description: string
  data: Buffer
}

export function prepareTags(tags: Record<string, string[]>): Record<string, string[]> {
  const result: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(tags)) {
    const lower = key.toLowerCase()
    if (lower.startsWith('replaygain') || lower === 'encoder') continue
    result[lower] = [...value]
  }

  for (const [tag, tots] of Object.entries(TOT_MAP)) {
    if (!(tag in result)) continue
    const used = [...tots].filter((t) => t in result)
    if (used.length === 0) continue

    const totVals = new Set<number>()
    const invalid: Array<[string, string]> = []
    for (const t of used) {
      const raw = result[t]![0]!
      const parsed = Number.parseInt(raw, 10)
      if (Number.isNaN(parsed)) {
        invalid.push([t, raw])
      } else {
        totVals.add(parsed)
      }
    }
    if (invalid.length > 0) {
      const details = invalid.map(([name, value]) => `${name}=${JSON.stringify(value)}`).join(', ')
      throw new Error(`Non-integer total values for ${tag}: ${details}`)
    }

    for (const t of used) {
      delete result[t]
    }

    if (totVals.size === 1) {
      const total = String([...totVals][0])
      const nr = result[tag]![0]!
      result[tag] = [`${nr}/${total}`]
    } else {
      throw new Error(`conflicting values of ${used.join(' and ')}`)
    }
  }

  return result
}

export async function readPreparedFlacTags(
  flacPath: string
): Promise<{ tags: Record<string, string[]>; hasTags: boolean }> {
  const raw = await readFLACTags(flacPath)
  const lower: Record<string, string[]> = {}
  for (const [key, values] of Object.entries(raw.values)) {
    lower[key.toLowerCase()] = values
  }
  const hasTags = Object.keys(lower).length > 0
  return { tags: prepareTags(lower), hasTags }
}

export async function readFlacPictures(flacPath: string): Promise<FlacPicture[]> {
  const handle = await open(flacPath, 'r')
  try {
    const magic = Buffer.alloc(4)
    await readExact(handle, magic)
    if (magic.toString('utf8') !== 'fLaC') {
      throw new Error(`not a FLAC file: ${flacPath}`)
    }

    const pictures: FlacPicture[] = []
    for (;;) {
      const header = Buffer.alloc(4)
      await readExact(handle, header)
      const isLast = (header[0]! & 0x80) !== 0
      const blockType = header[0]! & 0x7f
      const length = (header[1]! << 16) | (header[2]! << 8) | header[3]!
      const payload = Buffer.alloc(length)
      await readExact(handle, payload)
      if (blockType === 6) {
        pictures.push(parsePictureBlock(payload))
      }
      if (isLast) break
    }
    return pictures
  } finally {
    await handle.close()
  }
}

export function writeMp3Tags(
  mp3Path: string,
  tags: Record<string, string[]>,
  pictures: FlacPicture[]
): void {
  const id3: Record<string, unknown> = {}
  const userDefinedText: Array<{ description: string; value: string }> = []

  for (const [key, values] of Object.entries(tags)) {
    if (values.length === 0) continue
    const mapped = VORBIS_TO_ID3[key]
    if (mapped === 'comment') {
      id3.comment = { language: 'eng', text: values.join('; ') }
      continue
    }
    if (mapped) {
      id3[mapped] = values.join('; ')
      continue
    }
    userDefinedText.push({ description: key, value: values.join('; ') })
  }

  if (userDefinedText.length > 0) {
    id3.userDefinedText = userDefinedText
  }

  if (pictures.length > 0) {
    const images = pictures.map((pic) => ({
      mime: pic.mime || 'image/jpeg',
      type: { id: pic.type, name: pictureTypeName(pic.type) },
      description: pic.description || '',
      imageBuffer: pic.data
    }))
    id3.image = images.length === 1 ? images[0] : images
  }

  const result = NodeID3.write(id3, mp3Path)
  if (result !== true) {
    throw new Error(`failed to write ID3 tags for ${mp3Path}: ${String(result)}`)
  }
}

function parsePictureBlock(payload: Buffer): FlacPicture {
  let offset = 0
  const readUint32 = (): number => {
    const value = payload.readUInt32BE(offset)
    offset += 4
    return value
  }
  const type = readUint32()
  const mimeLen = readUint32()
  const mime = payload.subarray(offset, offset + mimeLen).toString('utf8')
  offset += mimeLen
  const descLen = readUint32()
  const description = payload.subarray(offset, offset + descLen).toString('utf8')
  offset += descLen
  offset += 16
  const dataLen = readUint32()
  const data = Buffer.from(payload.subarray(offset, offset + dataLen))
  return { type, mime, description, data }
}

function pictureTypeName(type: number): string {
  const names: Record<number, string> = {
    0: 'other',
    3: 'front cover',
    4: 'back cover'
  }
  return names[type] ?? 'other'
}

async function readExact(
  handle: Awaited<ReturnType<typeof open>>,
  buf: Buffer
): Promise<void> {
  let offset = 0
  while (offset < buf.length) {
    const { bytesRead } = await handle.read(buf, offset, buf.length - offset, null)
    if (bytesRead === 0) throw new Error('unexpected EOF')
    offset += bytesRead
  }
}
