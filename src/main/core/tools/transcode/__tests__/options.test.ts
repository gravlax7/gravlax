import { describe, expect, it } from 'vitest'
import { getDownconversionOptions, resolveSampleRateFamily } from '../options'

describe('resolveSampleRateFamily', () => {
  it('maps 44100 family', () => {
    expect(resolveSampleRateFamily(44100)).toBe(44100)
    expect(resolveSampleRateFamily(88200)).toBe(44100)
    expect(resolveSampleRateFamily(176400)).toBe(44100)
  })

  it('maps 48000 family', () => {
    expect(resolveSampleRateFamily(48000)).toBe(48000)
    expect(resolveSampleRateFamily(96000)).toBe(48000)
    expect(resolveSampleRateFamily(192000)).toBe(48000)
  })

  it('rejects unsupported rates', () => {
    expect(() => resolveSampleRateFamily(22050)).toThrow(/unsupported sample rate/)
  })
})

describe('getDownconversionOptions', () => {
  it('offers only MP3 for 16-bit lossless', () => {
    const options = getDownconversionOptions('/tmp/Artist - Album [WEB FLAC]', 'Lossless', 44100)
    expect(options.map((o) => o.id)).toEqual(['transcode-320', 'transcode-V0'])
    expect(options.every((o) => o.action === 'transcode')).toBe(true)
  })

  it('offers 16-bit + MP3 for 24/96', () => {
    const options = getDownconversionOptions(
      '/tmp/Artist - Album [WEB 24bit FLAC]',
      '24bit Lossless',
      96000
    )
    expect(options.map((o) => o.id)).toEqual([
      'downconvert-16-48000',
      'transcode-320',
      'transcode-V0'
    ])
    expect(options[0]?.name).toBe('16bit 48.0 kHz')
    expect(options[0]?.outputFolderName).toBe('Artist - Album [WEB FLAC]')
  })

  it('offers mid-rate + 16-bit + MP3 for 24/192', () => {
    const options = getDownconversionOptions(
      '/tmp/Artist - Album [WEB 24bit FLAC]',
      '24bit Lossless',
      192000
    )
    expect(options.map((o) => o.id)).toEqual([
      'downconvert-24-96000',
      'downconvert-16-48000',
      'transcode-320',
      'transcode-V0'
    ])
    expect(options[0]?.name).toBe('24bit 96.0 kHz')
    expect(options[0]?.outputFolderName).toBe('Artist - Album [WEB 24-96]')
  })

  it('uses 88.2 family for high-rate 44100 multiples', () => {
    const options = getDownconversionOptions(
      '/tmp/Artist - Album [WEB 24bit FLAC]',
      '24bit Lossless',
      176400
    )
    expect(options[0]?.id).toBe('downconvert-24-88200')
    expect(options[1]?.id).toBe('downconvert-16-44100')
  })
})
