import { describe, expect, it } from 'vitest'
import {
  SPECTRAL_PLACEHOLDER,
  spectralDescriptionPreview
} from '../spectralDescription'

describe('spectralDescriptionPreview', () => {
  const description = `${SPECTRAL_PLACEHOLDER}Release details`

  it('hides the spectral marker when no spectrals are selected', () => {
    expect(spectralDescriptionPreview(description, [])).toBe('Release details')
  })

  it('keeps the marker when spectrals will be hosted', () => {
    expect(spectralDescriptionPreview(description, [1])).toBe(description)
  })
})
