import { readdir } from 'node:fs/promises'
import { extname, join, relative, sep } from 'node:path'
import type { TranscodeBlocker, TranscodeEncoding, TranscodeInspection } from '@shared/types'
import { discoverFLACFiles } from '@main/core/tools/flacFiles'
import { readFLACStreamInfo } from '@main/core/tools/diagnostics/mqa'
import { getDownconversionOptions, resolveSampleRateFamily } from './options'
import { readPreparedFlacTags } from './tags'

export const LOSSY_EXTENSIONS = new Set(['.mp3', '.m4a', '.ogg', '.opus'])
export const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.pdf', '.gif'])
export const SKIP_EXTENSIONS = new Set(['.cue', '.log', '.m3u', '.m3u8', '.accurip'])

export interface TrackAudioInfo {
  relativePath: string
  absolutePath: string
  sampleRate: number
  channels: number
  bitsPerSample: number
  hasTags: boolean
}

export async function gatherTrackAudioInfo(workspacePath: string): Promise<TrackAudioInfo[]> {
  const files = await discoverFLACFiles(workspacePath)
  const tracks: TrackAudioInfo[] = []
  for (const file of files) {
    const stream = await readFLACStreamInfo(file.absolutePath)
    const { hasTags } = await readPreparedFlacTags(file.absolutePath)
    tracks.push({
      relativePath: file.relativePath,
      absolutePath: file.absolutePath,
      sampleRate: stream.sampleRate,
      channels: stream.channels,
      bitsPerSample: stream.bitsPerSample,
      hasTags
    })
  }
  return tracks
}

export async function findLossyFiles(root: string): Promise<string[]> {
  const found: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
        continue
      }
      if (!entry.isFile()) continue
      const ext = extname(entry.name).toLowerCase()
      if (LOSSY_EXTENSIONS.has(ext)) {
        found.push(relative(root, path).split(sep).join('/'))
      }
    }
  }
  await walk(root)
  found.sort((a, b) => a.localeCompare(b))
  return found
}

export function deriveEncoding(tracks: TrackAudioInfo[]): {
  encoding: TranscodeEncoding
  hybrid: boolean
  sampleRate: number
} {
  if (tracks.length === 0) {
    return { encoding: 'Lossless', hybrid: false, sampleRate: 0 }
  }
  const first = tracks[0]!
  const hybrid = tracks.some(
    (t) => t.bitsPerSample !== first.bitsPerSample || t.sampleRate !== first.sampleRate
  )
  const is24bit = hybrid
    ? tracks.some((t) => t.bitsPerSample === 24)
    : first.bitsPerSample === 24
  return {
    encoding: is24bit ? '24bit Lossless' : 'Lossless',
    hybrid,
    sampleRate: first.sampleRate
  }
}

export async function inspectTranscode(workspacePath: string): Promise<TranscodeInspection> {
  if (!workspacePath) {
    throw new Error('workspace path is required')
  }

  const tracks = await gatherTrackAudioInfo(workspacePath)
  const lossy = await findLossyFiles(workspacePath)
  const blockers: TranscodeBlocker[] = []

  if (tracks.length === 0) {
    blockers.push({ kind: 'empty', message: 'No FLAC files found in the workspace.' })
  }
  if (lossy.length > 0) {
    blockers.push({
      kind: 'lossy',
      message: `A lossy file was found in the folder (${lossy[0]}).`
    })
  }

  const multichannel = tracks.filter((t) => t.channels > 2)
  if (multichannel.length > 0) {
    blockers.push({
      kind: 'multichannel',
      message: `${multichannel[0]!.relativePath} has ${multichannel[0]!.channels} channels. Cannot convert to MP3.`
    })
  }

  const untagged = tracks.filter((t) => !t.hasTags)
  if (untagged.length > 0) {
    blockers.push({
      kind: 'untagged',
      message: `FLAC file has no tags: ${untagged[0]!.relativePath}`
    })
  }

  const { encoding, hybrid, sampleRate } = deriveEncoding(tracks)

  if (sampleRate > 0) {
    try {
      resolveSampleRateFamily(sampleRate)
    } catch {
      blockers.push({
        kind: 'invalid-rate',
        message: `Unsupported sample rate: ${sampleRate}`
      })
    }
  }

  let options =
    tracks.length === 0 || blockers.some((b) => b.kind === 'lossy' || b.kind === 'empty')
      ? []
      : getDownconversionOptions(workspacePath, encoding, sampleRate)

  const blockMp3 = blockers.some((b) => b.kind === 'multichannel' || b.kind === 'untagged')
  if (blockMp3) {
    options = options.filter((o) => o.action !== 'transcode')
  }

  return {
    encoding,
    sampleRate,
    trackCount: tracks.length,
    hybrid,
    options,
    blockers
  }
}
