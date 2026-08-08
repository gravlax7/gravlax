import { basename } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildDownconvertOutputPath, buildMp3OutputPath } from '../naming'

describe('buildMp3OutputPath', () => {
  it('replaces FLAC with MP3 bitrate', () => {
    expect(basename(buildMp3OutputPath('/tmp/Artist - Album [WEB FLAC]', 'V0'))).toBe(
      'Artist - Album [WEB MP3 V0]'
    )
    expect(basename(buildMp3OutputPath('/tmp/Artist - Album [WEB FLAC]', '320'))).toBe(
      'Artist - Album [WEB MP3 320]'
    )
  })

  it('replaces 24bit FLAC with MP3 bitrate', () => {
    expect(basename(buildMp3OutputPath('/tmp/Artist - Album [WEB 24bit FLAC]', 'V0'))).toBe(
      'Artist - Album [WEB MP3 V0]'
    )
  })

  it('replaces Lossless FLAC with MP3 + bitrate', () => {
    expect(basename(buildMp3OutputPath('/tmp/Artist - Album [WEB Lossless FLAC]', '320'))).toBe(
      'Artist - Album [WEB 320 MP3]'
    )
  })

  it('replaces bare Lossless and appends MP3', () => {
    expect(basename(buildMp3OutputPath('/tmp/Artist - Album [WEB Lossless]', 'V0'))).toBe(
      'Artist - Album [WEB V0] [MP3]'
    )
  })

  it('appends bracket for bare folder names', () => {
    expect(basename(buildMp3OutputPath('/tmp/Artist - Album', 'V0'))).toBe(
      'Artist - Album [MP3 V0]'
    )
  })
})

describe('buildDownconvertOutputPath', () => {
  it('rewrites 24bit FLAC to FLAC for 16-bit', () => {
    expect(
      basename(buildDownconvertOutputPath('/tmp/Artist - Album [WEB 24bit FLAC]', 16, 44100))
    ).toBe('Artist - Album [WEB FLAC]')
  })

  it('rewrites FLAC to 16bit FLAC', () => {
    expect(basename(buildDownconvertOutputPath('/tmp/Artist - Album [WEB FLAC]', 16, 44100))).toBe(
      'Artist - Album [WEB 16bit FLAC]'
    )
  })

  it('appends FLAC for bare names', () => {
    expect(basename(buildDownconvertOutputPath('/tmp/Artist - Album', 16, 44100))).toBe(
      'Artist - Album [FLAC]'
    )
  })

  it('uses 24-rate label for 24-bit rate reduction', () => {
    expect(
      basename(buildDownconvertOutputPath('/tmp/Artist - Album [WEB 24bit FLAC]', 24, 96000))
    ).toBe('Artist - Album [WEB 24-96]')
  })
})
