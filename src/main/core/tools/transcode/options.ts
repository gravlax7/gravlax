import { basename } from 'node:path'
import type {
  BitDepth,
  Bitrate,
  TranscodeEncoding,
  TranscodeOption
} from '@shared/types'
import { buildDownconvertOutputPath, buildMp3OutputPath, outputFolderName } from './naming'

export function resolveSampleRateFamily(sampleRate: number): number {
  if (sampleRate % 44100 === 0) return 44100
  if (sampleRate % 48000 === 0) return 48000
  throw new Error(`unsupported sample rate: ${sampleRate}`)
}

export function getDownconversionOptions(
  sourcePath: string,
  encoding: TranscodeEncoding,
  sampleRate: number
): TranscodeOption[] {
  const options: TranscodeOption[] = []

  if (encoding === '24bit Lossless' && sampleRate >= 176400) {
    const targetRate = sampleRate % 48000 === 0 ? 96000 : 88200
    const outputPath = buildDownconvertOutputPath(sourcePath, 24, targetRate)
    options.push({
      id: `downconvert-24-${targetRate}`,
      name: `24bit ${(targetRate / 1000).toFixed(1)} kHz`,
      action: 'downconvert',
      targetBitDepth: 24,
      targetSampleRate: targetRate,
      outputFolderName: outputFolderName(outputPath)
    })
  }

  if (encoding === '24bit Lossless' && sampleRate >= 44100) {
    const targetRate = sampleRate % 48000 === 0 ? 48000 : 44100
    const outputPath = buildDownconvertOutputPath(sourcePath, 16, targetRate)
    options.push({
      id: `downconvert-16-${targetRate}`,
      name: `16bit ${(targetRate / 1000).toFixed(1)} kHz`,
      action: 'downconvert',
      targetBitDepth: 16,
      targetSampleRate: targetRate,
      outputFolderName: outputFolderName(outputPath)
    })
  }

  if (encoding === 'Lossless' || encoding === '24bit Lossless') {
    for (const bitrate of ['320', 'V0'] as Bitrate[]) {
      const outputPath = buildMp3OutputPath(sourcePath, bitrate)
      options.push({
        id: `transcode-${bitrate}`,
        name: `MP3 ${bitrate}`,
        action: 'transcode',
        bitrate,
        outputFolderName: basename(outputPath)
      })
    }
  }

  return options
}

export function optionLabel(option: TranscodeOption): string {
  return option.name
}

export type { BitDepth, Bitrate }
