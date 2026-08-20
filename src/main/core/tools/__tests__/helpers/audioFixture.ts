import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { runCommand } from '../../runCommand'

export async function writeSyntheticFlac(
  destination: string,
  options: {
    bitsPerSample?: 16 | 24
    sampleRate?: number
    effectiveBits?: 16 | 24
    distinctChannels?: boolean
  } = {}
): Promise<void> {
  const bitsPerSample = options.bitsPerSample ?? 16
  const effectiveBits = options.effectiveBits ?? bitsPerSample
  const sampleRate = options.sampleRate ?? 44_100
  const channels = 2
  const bytesPerSample = bitsPerSample / 8
  const sampleCount = Math.floor(sampleRate / 4)
  const dataSize = sampleCount * channels * bytesPerSample
  const wav = Buffer.alloc(44 + dataSize)

  wav.write('RIFF', 0)
  wav.writeUInt32LE(36 + dataSize, 4)
  wav.write('WAVE', 8)
  wav.write('fmt ', 12)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(channels, 22)
  wav.writeUInt32LE(sampleRate, 24)
  wav.writeUInt32LE(sampleRate * channels * bytesPerSample, 28)
  wav.writeUInt16LE(channels * bytesPerSample, 32)
  wav.writeUInt16LE(bitsPerSample, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(dataSize, 40)

  const peak = effectiveBits === 16 ? 8_000 : 2_000_000
  for (let frame = 0; frame < sampleCount; frame++) {
    const sourceValue = Math.round(Math.sin((frame * 2 * Math.PI * 440) / sampleRate) * peak)
    for (let channel = 0; channel < channels; channel++) {
      const channelValue =
        options.distinctChannels && channel === 1
          ? Math.round(Math.sin((frame * 2 * Math.PI * 660) / sampleRate) * peak)
          : sourceValue
      const value =
        bitsPerSample === 24 && effectiveBits === 16 ? channelValue << 8 : channelValue
      const offset = 44 + (frame * channels + channel) * bytesPerSample
      wav.writeIntLE(value, offset, bytesPerSample)
    }
  }

  await mkdir(dirname(destination), { recursive: true })
  const wavPath = `${destination}.wav`
  await writeFile(wavPath, wav)
  try {
    await runCommand('flac', [
      '--silent',
      '--force',
      '--tag=ARTIST=Test Artist',
      '--tag=ALBUM=Synthetic Test Audio',
      '--tag=TITLE=Tone',
      '--tag=TRACKNUMBER=1',
      `--output-name=${destination}`,
      wavPath
    ])
  } finally {
    await rm(wavPath, { force: true })
  }
}
