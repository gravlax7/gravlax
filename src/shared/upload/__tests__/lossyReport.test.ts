import { describe, expect, it } from 'vitest'
import {
  addLossySource,
  buildLossyMasterComment,
  LOSSY_MASTER_SPECTRAL_REQUIRED,
  validateLossyMasterReport
} from '../lossyReport'

describe('lossy report drafts', () => {
  it('adds a source only on request, preserving notes and avoiding duplicates', () => {
    const source = 'https://example.com/release'
    const comment = 'My [b]notes[/b]\n'
    const added = addLossySource(comment, ` ${source} `)
    expect(added).toBe(`${comment}\n\nSourced from: ${source}`)
    expect(addLossySource(added, source)).toBe(added)
    expect(addLossySource(comment, '')).toBe(comment)
    expect(addLossySource('', source)).toBe(`Sourced from: ${source}`)
  })

  it('requires a source comment and at least one spectral when the upload is a lossy master', () => {
    expect(
      validateLossyMasterReport({ lossyMaster: false, lossyComment: '', spectralIds: [] })
    ).toBeNull()
    expect(
      validateLossyMasterReport({
        lossyMaster: true,
        lossyComment: 'Sourced from Bandcamp',
        spectralIds: [1]
      })
    ).toBeNull()
    expect(
      validateLossyMasterReport({
        lossyMaster: true,
        lossyComment: 'Sourced from Bandcamp',
        spectralIds: []
      })
    ).toBe(LOSSY_MASTER_SPECTRAL_REQUIRED)
    expect(
      validateLossyMasterReport({ lossyMaster: true, lossyComment: '  ', spectralIds: [1] })
    ).toBe('Add a comment about the source to the lossy master report.')
  })
})

describe('buildLossyMasterComment', () => {
  const spectrals = '[hide=Spectrals]x[/hide]\n'

  it('joins the edited comment, confirmed source, and spectrals', () => {
    const comment = addLossySource('Soft clipped', 'https://example.com/release')
    expect(buildLossyMasterComment({ comment, spectralBbcode: spectrals })).toBe(
      `Soft clipped\n\nSourced from: https://example.com/release\n\n${spectrals}`
    )
  })

  it('omits empty sections, including a cleared comment or no selected spectrals', () => {
    expect(buildLossyMasterComment({ spectralBbcode: spectrals })).toBe(spectrals)
    expect(buildLossyMasterComment({ comment: '  ', spectralBbcode: spectrals })).toBe(spectrals)
    expect(buildLossyMasterComment({ comment: ' My note ' })).toBe('My note')
    expect(buildLossyMasterComment({})).toBe('')
  })
})
