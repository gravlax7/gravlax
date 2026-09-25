import { describe, expect, it } from 'vitest'
import { getDownconversionOptions, sampleRateFamily } from '../options'

describe('sampleRateFamily', () => {
  it('maps 44100 family', () => {
    expect(sampleRateFamily(44100)).toBe(44100)
    expect(sampleRateFamily(88200)).toBe(44100)
    expect(sampleRateFamily(176400)).toBe(44100)
  })

  it('maps 48000 family', () => {
    expect(sampleRateFamily(48000)).toBe(48000)
    expect(sampleRateFamily(96000)).toBe(48000)
    expect(sampleRateFamily(192000)).toBe(48000)
  })

  it('leaves other rates alone', () => {
    expect(sampleRateFamily(22050)).toBeUndefined()
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

  it('offers one per-track 16-bit conversion for mixed 24-bit audio', () => {
    const options = getDownconversionOptions(
      '/tmp/Artist - Album [WEB 24bit FLAC]',
      '24bit Lossless',
      192000,
      true
    )
    expect(options.map((option) => option.id)).toEqual([
      'downconvert-16-mixed',
      'transcode-320',
      'transcode-V0'
    ])
    expect(options[0]).toMatchObject({
      name: '16bit FLAC',
      targetBitDepth: 16
    })
    expect(options[0]).not.toHaveProperty('targetSampleRate')
  })
})
