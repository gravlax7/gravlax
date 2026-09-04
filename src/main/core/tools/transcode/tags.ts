import { mkdtemp, open, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import NodeID3 from 'node-id3'
import { readFLACTags } from '@main/core/tags/extract'
import { readExact } from '@main/core/tools/readExact'
import { dateYear } from '@shared/tags/dates'
import { dropTranscodeOnlyTags, isTranscodeDroppedTag } from '@shared/tags/projection'
import { automaticToolResolver, type ToolResolver } from '@main/core/tools/binaries'
import { runCommand } from '@main/core/tools/runCommand'

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
  comment: 'comment',
  genre: 'genre',
  language: 'language',
  key: 'initialKey',
  bpm: 'bpm',
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
    if (isTranscodeDroppedTag(lower)) continue
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
  const hasTags = Object.keys(raw.values).length > 0
  return { tags: prepareTags(raw.values), hasTags }
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

export function id3TagsFromFlac(
  tags: Record<string, string[]>,
  pictures: FlacPicture[]
): Record<string, unknown> {
  const id3: Record<string, unknown> = {}
  const userDefinedText: Array<{ description: string; value: string }> = []
  const label = joined(tags.label)
  const publisher = joined(tags.publisher)

  for (const [key, values] of Object.entries(tags)) {
    if (values.length === 0) continue
    if (key === 'year' && tags.date) continue
    if (key === 'originalyear' && tags.originaldate) continue
    if (key === 'date' || key === 'year') {
      assignDateFrames(id3, userDefinedText, 'year', 'DATE', values)
      continue
    }
    if (key === 'originaldate' || key === 'originalyear') {
      assignDateFrames(id3, userDefinedText, 'originalYear', 'ORIGINALDATE', values)
      continue
    }
    if (key === 'label') {
      id3.publisher = values.join('; ')
      continue
    }
    if (key === 'publisher') {
      if (!label) {
        id3.publisher = publisher
      } else if (publisher && publisher !== label) {
        userDefinedText.push({ description: 'PUBLISHER', value: values.join('; ') })
      }
      continue
    }
    const mapped = VORBIS_TO_ID3[key]
    if (mapped === 'comment') {
      id3.comment = { language: 'xxx', text: values.join('; ') }
      continue
    }
    if (mapped) {
      id3[mapped] = values.join('; ')
      continue
    }
    userDefinedText.push({ description: key.toUpperCase(), value: values.join('; ') })
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

  return id3
}

export function writeMp3Tags(
  mp3Path: string,
  tags: Record<string, string[]>,
  pictures: FlacPicture[]
): void {
  const result = NodeID3.write(id3TagsFromFlac(tags, pictures), mp3Path)
  if (result !== true) {
    throw new Error(`failed to write ID3 tags for ${mp3Path}: ${String(result)}`)
  }
}

export async function mp3OutputMatchesSource(
  mp3Path: string,
  tags: Record<string, string[]>,
  pictures: FlacPicture[]
): Promise<boolean> {
  const expected = fingerprintId3(id3TagsFromFlac(tags, pictures))
  const actual = fingerprintId3(NodeID3.read(mp3Path) as Record<string, unknown>)
  return expected === actual
}

export async function flacOutputMatchesSource(
  outputPath: string,
  sourceTags: Record<string, string[]>,
  sourcePictures: FlacPicture[]
): Promise<boolean> {
  const actualTags: Record<string, string[]> = {}
  for (const [key, values] of Object.entries((await readFLACTags(outputPath)).values)) {
    actualTags[key.trim().toUpperCase()] = values
  }
  const expectedTags = dropTranscodeOnlyTags(sourceTags)
  if (tagFingerprint(actualTags) !== tagFingerprint(expectedTags)) return false
  const actualPictures = await readFlacPictures(outputPath)
  return pictureFingerprint(actualPictures) === pictureFingerprint(sourcePictures)
}

export async function restoreFlacTagsAndPictures(
  sourcePath: string,
  destPath: string,
  signal?: AbortSignal,
  tools: ToolResolver = automaticToolResolver
): Promise<void> {
  const source = await readFLACTags(sourcePath)
  const pictures = await readFlacPictures(sourcePath)
  const tags = dropTranscodeOnlyTags(source.values)
  await writeFlacTagsAndPictures(destPath, tags, pictures, signal, tools)
  if (!(await flacOutputMatchesSource(destPath, tags, pictures))) {
    throw new Error(`Tag verification failed for ${destPath}.`)
  }
}

async function writeFlacTagsAndPictures(
  path: string,
  tags: Record<string, string[]>,
  pictures: FlacPicture[],
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<void> {
  const workDir = await mkdtemp(join(tmpdir(), 'gravlax-flac-tags-'))
  try {
    await runCommand('metaflac', ['--remove-all-tags', path], signal, undefined, tools)
    await runCommand(
      'metaflac',
      ['--dont-use-padding', '--remove', '--block-type=PICTURE', path],
      signal,
      undefined,
      tools
    ).catch(() => undefined)
    const args = ['--no-utf8-convert']
    let valueIndex = 0
    for (const [key, items] of Object.entries(tags)) {
      for (const value of items) {
        const valuePath = join(workDir, String(valueIndex++))
        await writeFile(valuePath, value, { encoding: 'utf8', mode: 0o600 })
        args.push(`--set-tag-from-file=${key}=${valuePath}`)
      }
    }
    if (args.length > 1) {
      args.push(path)
      await runCommand('metaflac', args, signal, undefined, tools)
    }
    for (const [index, picture] of pictures.entries()) {
      const picturePath = join(workDir, `picture-${index}`)
      await writeFile(picturePath, picture.data)
      const spec = `${picture.type}|${picture.mime}|${picture.description}|${picturePath}`
      await runCommand('metaflac', [`--import-picture-from=${spec}`, path], signal, undefined, tools)
    }
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

function assignDateFrames(
  id3: Record<string, unknown>,
  userDefinedText: Array<{ description: string; value: string }>,
  native: 'year' | 'originalYear',
  exactName: 'DATE' | 'ORIGINALDATE',
  values: string[]
): void {
  const text = values.join('; ')
  const year = dateYear(text)
  if (year) id3[native] = year
  if (text && text !== year) {
    userDefinedText.push({ description: exactName, value: text })
  }
}

function joined(values: string[] | undefined): string {
  return (values ?? []).join('; ')
}

function fingerprintId3(tags: Record<string, unknown>): string {
  const txxx = normalizeUserText(tags.userDefinedText)
  const images = normalizeImages(tags.image)
  const comment = tags.comment as { language?: string; text?: string } | string | undefined
  return JSON.stringify({
    title: tags.title ?? '',
    album: tags.album ?? '',
    artist: tags.artist ?? '',
    performerInfo: tags.performerInfo ?? '',
    conductor: tags.conductor ?? '',
    remixArtist: tags.remixArtist ?? '',
    composer: tags.composer ?? '',
    trackNumber: tags.trackNumber ?? '',
    partOfSet: tags.partOfSet ?? '',
    year: tags.year ?? '',
    originalYear: tags.originalYear ?? '',
    genre: tags.genre ?? '',
    publisher: tags.publisher ?? '',
    ISRC: tags.ISRC ?? '',
    comment:
      typeof comment === 'string'
        ? { language: '', text: comment }
        : { language: comment?.language ?? '', text: comment?.text ?? '' },
    txxx,
    images
  })
}

function normalizeUserText(value: unknown): Array<{ description: string; value: string }> {
  const items = Array.isArray(value) ? value : value ? [value] : []
  return items
    .map((item) => {
      const row = item as { description?: string; value?: string }
      return {
        description: (row.description ?? '').toUpperCase(),
        value: row.value ?? ''
      }
    })
    .sort((a, b) => a.description.localeCompare(b.description) || a.value.localeCompare(b.value))
}

function normalizeImages(value: unknown): string[] {
  const items = Array.isArray(value) ? value : value ? [value] : []
  return items.map((item) => {
    const image = item as {
      mime?: string
      description?: string
      imageBuffer?: Buffer
      type?: { id?: number }
    }
    const type = image.type?.id ?? 0
    const mime = image.mime ?? ''
    const description = image.description ?? ''
    const data = Buffer.isBuffer(image.imageBuffer)
      ? image.imageBuffer.toString('base64')
      : ''
    return `${type}|${mime}|${description}|${data}`
  })
}

function tagFingerprint(tags: Record<string, string[]>): string {
  const keys = Object.keys(tags).sort()
  return JSON.stringify(
    Object.fromEntries(keys.map((key) => [key.toUpperCase(), tags[key]]))
  )
}

function pictureFingerprint(pictures: FlacPicture[]): string {
  return pictures
    .map((pic) => `${pic.type}|${pic.mime}|${pic.description}|${pic.data.toString('base64')}`)
    .join('\n')
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
