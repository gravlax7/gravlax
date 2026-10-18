import { open } from 'node:fs/promises'
import { readExact } from '@main/core/tools/readExact'

const STREAMINFO = 0
const PADDING = 1
const VORBIS_COMMENT = 4
export const PICTURE_BLOCK = 6

export class NotFLACError extends Error {
  constructor() {
    super('not a FLAC file')
    this.name = 'NotFLACError'
  }
}

export interface FlacStreamInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  totalSamples: number
  durationSeconds: number
}

export interface FlacLayout {
  stream: FlacStreamInfo
  vendor: string
  comments: Record<string, string[]>
  pictureCount: number
  pictureBytes: number
  paddingBytes: number
  /** File size minus the marker and every metadata block. */
  audioBytes: number
}

interface FlacBlock {
  type: number
  length: number
  payload?: Buffer
}

/** Walks the metadata blocks, reading payloads only for the given block types. */
export async function readFlacBlocks(
  path: string,
  payloadTypes: number[]
): Promise<{ blocks: FlacBlock[]; audioBytes: number }> {
  const handle = await open(path, 'r')
  try {
    const magic = Buffer.alloc(4)
    await readExact(handle, magic, 0)
    if (magic.toString('utf8') !== 'fLaC') throw new NotFLACError()

    const blocks: FlacBlock[] = []
    let position = 4
    for (;;) {
      const header = Buffer.alloc(4)
      await readExact(handle, header, position)
      position += 4
      const type = header[0]! & 0x7f
      const length = (header[1]! << 16) | (header[2]! << 8) | header[3]!
      const block: FlacBlock = { type, length }
      if (payloadTypes.includes(type)) {
        block.payload = Buffer.alloc(length)
        await readExact(handle, block.payload, position)
      }
      blocks.push(block)
      position += length
      if ((header[0]! & 0x80) !== 0) break
    }
    const { size } = await handle.stat()
    return { blocks, audioBytes: size - position }
  } finally {
    await handle.close()
  }
}

export async function readFlacLayout(path: string): Promise<FlacLayout> {
  const { blocks, audioBytes } = await readFlacBlocks(path, [STREAMINFO, VORBIS_COMMENT])
  const first = blocks[0]!
  if (first.type !== STREAMINFO) throw new Error('missing STREAMINFO metadata block')
  const comment = blocks.find((block) => block.type === VORBIS_COMMENT)?.payload
  const { vendor, comments } = comment
    ? parseVorbisComments(comment)
    : { vendor: '', comments: {} }
  const sum = (type: number) =>
    blocks.filter((block) => block.type === type).reduce((total, block) => total + block.length, 0)
  return {
    stream: parseStreamInfo(first.payload!),
    vendor,
    comments,
    pictureCount: blocks.filter((block) => block.type === PICTURE_BLOCK).length,
    pictureBytes: sum(PICTURE_BLOCK),
    paddingBytes: sum(PADDING),
    audioBytes
  }
}

export async function readFLACStreamInfo(path: string): Promise<FlacStreamInfo> {
  return (await readFlacLayout(path)).stream
}

function parseStreamInfo(data: Buffer): FlacStreamInfo {
  if (data.length < 34) throw new Error(`invalid STREAMINFO length: ${data.length}`)
  const sampleRate = (data[10]! << 12) | (data[11]! << 4) | (data[12]! >> 4)
  const channels = ((data[12]! >> 1) & 0x07) + 1
  const bitsPerSample = (((data[12]! & 0x01) << 4) | (data[13]! >> 4)) + 1
  const totalSamples =
    (data[13]! & 0x0f) * 0x100000000 +
    data[14]! * 0x1000000 +
    data[15]! * 0x10000 +
    data[16]! * 0x100 +
    data[17]!
  if (sampleRate <= 0) throw new Error('cannot determine sample rate')
  if (bitsPerSample <= 0 || bitsPerSample > 32) {
    throw new Error(`unsupported bits per sample: ${bitsPerSample}`)
  }
  return {
    sampleRate,
    channels,
    bitsPerSample,
    totalSamples,
    durationSeconds: totalSamples > 0 ? totalSamples / sampleRate : 0
  }
}

function parseVorbisComments(payload: Buffer): {
  vendor: string
  comments: Record<string, string[]>
} {
  let offset = 0
  const readUint32 = (): number => {
    const value = payload.readUInt32LE(offset)
    offset += 4
    return value
  }
  const readString = (): string => {
    const length = readUint32()
    const value = payload.subarray(offset, offset + length).toString('utf8')
    offset += length
    return value
  }

  const vendor = readString()
  const commentCount = readUint32()
  const comments: Record<string, string[]> = {}
  for (let i = 0; i < commentCount; i++) {
    const comment = readString()
    const eq = comment.indexOf('=')
    if (eq < 0) continue
    const key = comment.slice(0, eq).trim().toUpperCase()
    const value = comment.slice(eq + 1).trim()
    if (!key || !value) continue
    ;(comments[key] ??= []).push(value)
  }
  return { vendor, comments }
}
