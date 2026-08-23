import { describe, expect, it } from 'vitest'
import { WORKFLOW_STEPS } from '../steps'

describe('workflow step catalog', () => {
  it('defines the upload pipeline in order without repeated ids', () => {
    const ids = WORKFLOW_STEPS.map((step) => step.id)
    expect(ids).toEqual([
      'files-check',
      'spectrals',
      'metadata',
      'tags',
      'transcode',
      'upload',
      'seed'
    ])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
