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
    expect(desc).toContain('16 bit 48.00 kHz')
    expect(desc).toContain(`[b]Source:[/b] ${SOURCE_TORRENT_PLACEHOLDER}`)
    expect(desc).not.toContain('More info')
    expect(desc).toContain('[hr]Uploaded with [b]gravlax[/b] v9.8.7')
  })

  it('returns nothing when sample rate is missing', () => {
    expect(generateConversionDescription(null, 16, '9.8.7')).toBe('')
  })
})
