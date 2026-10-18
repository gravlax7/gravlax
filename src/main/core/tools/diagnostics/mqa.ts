import { spawn } from 'node:child_process'
import { automaticToolResolver, type ToolResolver } from '@main/core/tools/binaries'
import { readFLACStreamInfo, type FlacStreamInfo } from '@main/core/tools/flacLayout'

const MQA_MAGIC = 0xbe0498c88
const MQA_MAGIC_BITS = 36
const MQA_MASK = 0x1000000000

export async function checkMQA(
  path: string,
  signal?: AbortSignal,
  tools: ToolResolver = automaticToolResolver
): Promise<boolean> {
  const info = await readFLACStreamInfo(path)
  if (info.channels !== 2) {
    throw new Error(`input must be stereo: got ${info.channels} channel(s)`)
  }
  const { left, right } = await decodeFirstSecond(path, info, signal, tools)
  return checkMQASyncword(left, right)
}

async function decodeFirstSecond(
  path: string,
  info: FlacStreamInfo,
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<{ left: Int32Array; right: Int32Array }> {
  const raw = await runFlacDecode(path, info.sampleRate, signal, tools)
  return decodeRawStereoSamples(raw, info.bitsPerSample)
}

async function runFlacDecode(
  path: string,
  sampleRate: number,
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<Buffer> {
  const executable = await tools.require('flac')
  return new Promise((resolve, reject) => {
    const child = spawn(
      executable,
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
