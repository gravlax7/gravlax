import { spawn } from 'node:child_process'
import { open } from 'node:fs/promises'

const MQA_MAGIC = 0xbe0498c88
const MQA_MAGIC_BITS = 36
const MQA_MASK = 0x1000000000

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

export async function checkMQA(path: string, signal?: AbortSignal): Promise<boolean> {
  const info = await readFLACStreamInfo(path)
  if (info.channels !== 2) {
    throw new Error(`input must be stereo: got ${info.channels} channel(s)`)
  }
  const { left, right } = await decodeFirstSecond(path, info, signal)
  return checkMQASyncword(left, right)
}

export async function readFLACStreamInfo(path: string): Promise<FlacStreamInfo> {
  const handle = await open(path, 'r')
  try {
    const magic = Buffer.alloc(4)
    await readExact(handle, magic)
    if (magic.toString('utf8') !== 'fLaC') {
      throw new NotFLACError()
    }

    const header = Buffer.alloc(4)
    await readExact(handle, header)
    const blockType = header[0]! & 0x7f
    const length = (header[1]! << 16) | (header[2]! << 8) | header[3]!
    if (blockType !== 0) {
      throw new Error('missing STREAMINFO metadata block')
    }
    if (length < 34) {
      throw new Error(`invalid STREAMINFO length: ${length}`)
    }

    const data = Buffer.alloc(length)
    await readExact(handle, data)

    const sampleRate = (data[10]! << 12) | (data[11]! << 4) | (data[12]! >> 4)
    const channels = ((data[12]! >> 1) & 0x07) + 1
    const bitsPerSample = (((data[12]! & 0x01) << 4) | (data[13]! >> 4)) + 1
    const totalSamples =
      (data[13]! & 0x0f) * 0x100000000 +
      data[14]! * 0x1000000 +
      data[15]! * 0x10000 +
      data[16]! * 0x100 +
      data[17]!
    if (sampleRate <= 0) {
      throw new Error('cannot determine sample rate')
    }
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
  } finally {
    await handle.close()
  }
}

async function readExact(handle: Awaited<ReturnType<typeof open>>, buf: Buffer): Promise<void> {
  let offset = 0
  while (offset < buf.length) {
    const { bytesRead } = await handle.read(buf, offset, buf.length - offset, null)
    if (bytesRead === 0) throw new Error('unexpected EOF')
    offset += bytesRead
  }
}

async function decodeFirstSecond(
  path: string,
  info: FlacStreamInfo,
  signal?: AbortSignal
): Promise<{ left: Int32Array; right: Int32Array }> {
  const raw = await runFlacDecode(path, info.sampleRate, signal)
  return decodeRawStereoSamples(raw, info.bitsPerSample)
}

function runFlacDecode(path: string, sampleRate: number, signal?: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'flac',
      [
        '-d',
        '--silent',
        '--stdout',
        '--force-raw-format',
        '--endian=little',
        '--sign=signed',
        `--until=${sampleRate}`,
        path
      ],
      { signal }
    )
    const chunks: Buffer[] = []
    const errChunks: Buffer[] = []
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('flac decode timed out'))
    }, 30_000)
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))
    child.on('error', (err) => {
      clearTimeout(timeout)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve(Buffer.concat(chunks))
        return
      }
      reject(new Error(`decode FLAC file: exit ${code}: ${Buffer.concat(errChunks).toString()}`))
    })
  })
}

export function decodeRawStereoSamples(
  raw: Buffer,
  bitsPerSample: number
): { left: Int32Array; right: Int32Array } {
  const bytesPerSample = Math.floor((bitsPerSample + 7) / 8)
  if (bytesPerSample <= 0 || bytesPerSample > 4) {
    throw new Error(`unsupported bits per sample: ${bitsPerSample}`)
  }
  const frameSize = bytesPerSample * 2
  if (raw.length < frameSize) {
    throw new Error('no audio frames decoded')
  }
  if (raw.length % frameSize !== 0) {
    throw new Error(`decoded PCM length is not frame-aligned: ${raw.length} bytes`)
  }
  const frames = raw.length / frameSize
  const left = new Int32Array(frames)
  const right = new Int32Array(frames)
  for (let i = 0; i < frames; i++) {
    const offset = i * frameSize
    left[i] = decodeSignedSample(raw.subarray(offset, offset + bytesPerSample), bitsPerSample)
    right[i] = decodeSignedSample(
      raw.subarray(offset + bytesPerSample, offset + frameSize),
      bitsPerSample
    )
  }
  return { left, right }
}

export function decodeSignedSample(raw: Buffer, bitsPerSample: number): number {
  let value = 0
  for (let i = 0; i < raw.length; i++) {
    value |= raw[i]! << (i * 8)
  }
  if (bitsPerSample < 32) {
    const mask = (1 << bitsPerSample) - 1
    const signBit = 1 << (bitsPerSample - 1)
    value &= mask
    if ((value & signBit) !== 0) {
      value |= ~mask
    }
  }
  return (value << (32 - bitsPerSample)) | 0
}

export function checkMQASyncword(left: Int32Array, right: Int32Array): boolean {
  const samples = Math.min(left.length, right.length)
  if (samples < MQA_MAGIC_BITS) {
    return false
  }

  for (let bitPosition = 16; bitPosition < 24; bitPosition++) {
    let window = 0
    for (let i = 0; i < samples; i++) {
      const xor = (left[i]! ^ right[i]!) >>> 0
      const bit = (xor >>> bitPosition) & 1
      window = (window * 2 + bit) % MQA_MASK
      if (i >= MQA_MAGIC_BITS - 1 && window === MQA_MAGIC) {
        return true
      }
    }
  }
  return false
}

export function plantSyncword(
  samples: number,
  bitPosition: number,
  startIndex: number,
  negativeXor = false
): { left: Int32Array; right: Int32Array } {
  const left = new Int32Array(samples)
  const right = new Int32Array(samples)
  for (let i = 0; i < MQA_MAGIC_BITS; i++) {
    const shift = MQA_MAGIC_BITS - 1 - i
    const bit = Math.floor(MQA_MAGIC / 2 ** shift) % 2
    const idx = startIndex + i
    if (idx >= samples) break
    let xor = (bit << bitPosition) >>> 0
    if (negativeXor) {
      xor = (xor | 0x80000000) >>> 0
    }
    left[idx] = xor | 0
    right[idx] = 0
  }
  return { left, right }
}
