import { basename, dirname, join } from 'node:path'
import type { BitDepth, Bitrate } from '@shared/types'
import { projectDownconvertFolderName, projectMp3FolderName } from '@shared/upload/naming'

export function buildMp3OutputPath(path: string, bitrate: Bitrate): string {
  const foldername = projectMp3FolderName(basename(path), bitrate)
  return join(dirname(path), foldername)
}

export function buildDownconvertOutputPath(
  path: string,
  bitDepth: BitDepth,
  sampleRate: number | null
): string {
  const sampleRateKhz = sampleRate ? Number((sampleRate / 1000).toFixed(0)) : null
  const foldername = projectDownconvertFolderName(basename(path), bitDepth, sampleRateKhz)
  return join(dirname(path), foldername)
}

export function outputFolderName(path: string): string {
  return basename(path)
}
