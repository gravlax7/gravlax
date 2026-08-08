import { describe, expect, it } from 'vitest'
import {
  clampSpectralIds,
  parseSpectralIds,
  spectralIdsForRelease,
  toggleSpectralId
} from '../spectralIds'

describe('parseSpectralIds', () => {
  it('selects everything for *', () => {
    expect(parseSpectralIds('*', 3)).toEqual([1, 2, 3])
    expect(parseSpectralIds('*', 0)).toEqual([])
  })

  it('selects nothing for 0, empty, or undefined', () => {
    expect(parseSpectralIds('0', 5)).toEqual([])
    expect(parseSpectralIds('', 5)).toEqual([])
    expect(parseSpectralIds('   ', 5)).toEqual([])
    expect(parseSpectralIds(undefined, 5)).toEqual([])
  })

  it('reads the names the settings screen writes', () => {
    expect(parseSpectralIds('All', 3)).toEqual([1, 2, 3])
    expect(parseSpectralIds('None', 3)).toEqual([])
    expect(parseSpectralIds('First track', 3)).toEqual([1])
    expect(parseSpectralIds('Random', 3, () => 2)).toEqual([2])
  })

  it('has nothing to pick from an empty release', () => {
    expect(parseSpectralIds('First track', 0)).toEqual([])
    expect(parseSpectralIds('Random', 0, () => 1)).toEqual([])
  })

  it('picks a real track for Random', () => {
    for (let i = 0; i < 50; i++) {
      const [id] = parseSpectralIds('Random', 4)
      expect(id).toBeGreaterThanOrEqual(1)
      expect(id).toBeLessThanOrEqual(4)
    }
  })

  it('parses lists', () => {
    expect(parseSpectralIds('1,3,5', 6)).toEqual([1, 3, 5])
    expect(parseSpectralIds(' 2 , 1 ', 6)).toEqual([1, 2])
  })

  it('parses ranges, including reversed ones', () => {
    expect(parseSpectralIds('2-4', 6)).toEqual([2, 3, 4])
    expect(parseSpectralIds('4-2', 6)).toEqual([2, 3, 4])
    expect(parseSpectralIds('1,3-5', 6)).toEqual([1, 3, 4, 5])
  })

  it('drops ids outside the track range', () => {
    expect(parseSpectralIds('1,9,12', 5)).toEqual([1])
    expect(parseSpectralIds('4-8', 5)).toEqual([4, 5])
    expect(parseSpectralIds('0,1', 5)).toEqual([1])
  })

  it('de-duplicates and sorts', () => {
    expect(parseSpectralIds('3,1,3,2-3', 5)).toEqual([1, 2, 3])
  })

  it('ignores unparseable tokens', () => {
    expect(parseSpectralIds('1,abc,,2', 5)).toEqual([1, 2])
  })
})

describe('spectralIdsForRelease', () => {
  const cfg = { defaultSpectralIds: '1,2', defaultSpectralIdsForLossyMasters: '*' }

  it('uses the normal default when not a lossy master', () => {
    expect(spectralIdsForRelease(cfg, false, 4)).toEqual([1, 2])
  })

  it('uses the lossy-master default when flagged', () => {
    expect(spectralIdsForRelease(cfg, true, 4)).toEqual([1, 2, 3, 4])
  })

  it('applies the shipped defaults', () => {
    const shipped = { defaultSpectralIds: 'Random', defaultSpectralIdsForLossyMasters: 'All' }
    expect(spectralIdsForRelease(shipped, false, 3, () => 3)).toEqual([3])
    expect(spectralIdsForRelease(shipped, true, 3)).toEqual([1, 2, 3])
  })
})

describe('toggleSpectralId', () => {
  it('adds, removes, and keeps the list sorted', () => {
    expect(toggleSpectralId([1, 3], 2)).toEqual([1, 2, 3])
    expect(toggleSpectralId([1, 2, 3], 2)).toEqual([1, 3])
    expect(toggleSpectralId([], 4)).toEqual([4])
  })
})

describe('clampSpectralIds', () => {
  it('drops ids with no track behind them', () => {
    expect(clampSpectralIds([1, 4, 9], 5)).toEqual([1, 4])
    expect(clampSpectralIds([0, -1, 2, 2], 5)).toEqual([2])
    expect(clampSpectralIds([1, 2], 0)).toEqual([])
  })
})
