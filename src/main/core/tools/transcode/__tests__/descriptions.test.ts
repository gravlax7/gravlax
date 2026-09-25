import { describe, expect, it } from 'vitest'
import { SOURCE_TORRENT_PLACEHOLDER } from '@main/core/tools/upload/descriptions'
import { generateConversionDescription } from '../flacConvert'
import { generateTranscodeDescription } from '../mp3'

describe('generateTranscodeDescription', () => {
  it('points at the source FLAC torrent placeholder', () => {
    const desc = generateTranscodeDescription('V0', '9.8.7')
    expect(desc).toContain(`[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}`)
    expect(desc).not.toContain('More info')
    expect(desc).toContain(
      '[code]flac -Vdsc -- input.flac | lame -S -V 0 --vbr-new --ignore-tag-errors - output.mp3[/code]'
    )
    expect(desc).toContain('[hr]Uploaded with [b]gravlax[/b] v9.8.7')
  })

})

describe('generateConversionDescription', () => {
  it('points at the source FLAC torrent placeholder', () => {
    const desc = generateConversionDescription(48000, 16, '9.8.7')
    expect(desc).toContain('16 bit [color=#2E86C1]48.0[/color] kHz')
    expect(desc).toContain(`[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}`)
    expect(desc).not.toContain('More info')
    expect(desc).toContain('[hr]Uploaded with [b]gravlax[/b] v9.8.7')
  })

  it('returns nothing when sample rate is missing', () => {
    expect(generateConversionDescription(null, 16, '9.8.7')).toBe('')
  })

  it('describes each output track when rates remain mixed', () => {
    const desc = generateConversionDescription(null, 16, '9.8.7', [
      { title: 'First', durationSeconds: 60, bitDepth: 16, sampleRate: 44100 },
      { title: 'Second', durationSeconds: 90, bitDepth: 16, sampleRate: 48000 }
    ])
    expect(desc).toContain('[b]Mixed audio properties[/b]')
    expect(desc).toContain('First [i](1:00)[/i] [16 bit / 44.1 kHz]')
    expect(desc).toContain('Second [i](1:30)[/i] [16 bit / 48.0 kHz]')
    expect(desc).toContain('For those tracks, it resamples rates in the 44.1 kHz family')
    expect(desc).toContain('Existing 16-bit FLAC tracks are copied unchanged.')
    expect(desc).not.toContain('[code]')
  })
})
