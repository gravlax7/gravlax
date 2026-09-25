import { describe, expect, it } from 'vitest'
import { newState, setDefaultSpectralIds, setSpectralIds } from '../state'
import { spectralIdsForRelease, toggleSpectralId } from '@shared/upload/spectralIds'

describe('spectral selection defaults', () => {
  const options = { defaultSpectralIds: 'None', defaultSpectralIdsForLossyMasters: 'All' }

  it('does not publish another state when loading spectrals with the None default', () => {
    const state = newState()
    const ids = spectralIdsForRelease(options, false, 3)

    expect(setDefaultSpectralIds(state, ids)).toBe(state)
    expect(state.draft.spectralIdsAuto).toBe(true)
  })

  it('does not publish another state for the same nonempty default', () => {
    const state = setDefaultSpectralIds(newState(), [1, 3])

    expect(setDefaultSpectralIds(state, [3, 1, 3])).toBe(state)
  })

  it('still applies the lossy default after an automatic empty selection', () => {
    const state = setDefaultSpectralIds(newState(), [])
    const next = setDefaultSpectralIds(state, spectralIdsForRelease(options, true, 3))

    expect(next.draft.spectralIds).toEqual([1, 2, 3])
    expect(next.draft.spectralIdsAuto).toBe(true)
    expect(setDefaultSpectralIds(next, []).draft.spectralIds).toEqual([])
  })

  it('preserves individual choices and an explicit Select none against later defaults', () => {
    let state = setDefaultSpectralIds(newState(), [])
    for (const id of [1, 2]) {
      state = setSpectralIds(state, toggleSpectralId(state.draft.spectralIds, id))
    }

    expect(state.draft.spectralIds).toEqual([1, 2])
    expect(setDefaultSpectralIds(state, [])).toBe(state)

    state = setSpectralIds(state, [])
    expect(state.draft.spectralIdsAuto).toBe(false)
    expect(setDefaultSpectralIds(state, [1, 2, 3])).toBe(state)
  })
})
