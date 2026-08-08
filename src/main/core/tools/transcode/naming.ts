import { basename, dirname, join } from 'node:path'
import type { BitDepth, Bitrate } from '@shared/types'

const FLAC_FOLDER_RE = /(24 ?bit )?FLAC/i
const LOSSLESS_FOLDER_RE = /Lossless/i
const BIT24_FLAC_RE = /24 ?bit FLAC/i

export function buildMp3OutputPath(path: string, bitrate: Bitrate): string {
  const toAppend: string[] = []
  let foldername = basename(path)

  if (FLAC_FOLDER_RE.test(foldername)) {
    if (LOSSLESS_FOLDER_RE.test(foldername)) {
      foldername = foldername.replace(FLAC_FOLDER_RE, 'MP3')
      foldername = foldername.replace(LOSSLESS_FOLDER_RE, bitrate)
    } else {
      foldername = foldername.replace(FLAC_FOLDER_RE, `MP3 ${bitrate}`)
    }
  } else if (LOSSLESS_FOLDER_RE.test(foldername)) {
    foldername = foldername.replace(LOSSLESS_FOLDER_RE, bitrate)
    toAppend.push('MP3')
  } else {
    toAppend.push(`MP3 ${bitrate}`)
  }

  if (toAppend.length > 0) {
    foldername += ` [${toAppend.join(' ')}]`
  }

  return join(dirname(path), foldername)
}

export function buildDownconvertOutputPath(
  path: string,
  bitDepth: BitDepth,
  sampleRate: number | null
): string {
  let foldername = basename(path)

  if (BIT24_FLAC_RE.test(foldername)) {
    foldername = foldername.replace(BIT24_FLAC_RE, 'FLAC')
  } else if (/FLAC/i.test(foldername)) {
    foldername = foldername.replace(/FLAC/i, '16bit FLAC')
  } else {
    foldername += ' [FLAC]'
  }

  if (sampleRate && bitDepth === 24) {
    foldername = foldername.replace(/FLAC/i, `24-${(sampleRate / 1000).toFixed(0)}`)
  }

  return join(dirname(path), foldername)
}

export function outputFolderName(path: string): string {
  return basename(path)
}
