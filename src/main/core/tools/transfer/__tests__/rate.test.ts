import { describe, expect, it } from 'vitest'
import { createRateMeter } from '../rate'

describe('createRateMeter', () => {
  it('reports nothing until it has two samples', () => {
    const meter = createRateMeter()
    expect(meter.sample(0, 1000)).toBe(0)
    expect(meter.bytesPerSecond()).toBe(0)
  })

  it('measures a steady transfer', () => {
    const meter = createRateMeter()
    meter.sample(0, 0)
    let rate = 0
    // 1 MB/s for 10 seconds.
    for (let t = 1000; t <= 10_000; t += 1000) {
      rate = meter.sample(t * 1000, t)
    }
    expect(rate).toBeCloseTo(1_000_000, -3)
  })

  it('converges towards a new rate rather than jumping to it', () => {
    const meter = createRateMeter()
    meter.sample(0, 0)
    meter.sample(1_000_000, 1000)
    expect(meter.bytesPerSecond()).toBeCloseTo(1_000_000, -3)

    // Throughput drops to a tenth; one sample must not fully believe it.
    const next = meter.sample(1_100_000, 2000)
    expect(next).toBeLessThan(1_000_000)
    expect(next).toBeGreaterThan(100_000)
  })

  it('decays towards zero when the transfer stalls', () => {
    const meter = createRateMeter()
    meter.sample(0, 0)
    meter.sample(1_000_000, 1000)

    // Ten seconds of silence against a three-second window leaves a few percent.
    const stalled = meter.sample(1_000_000, 11_000)
    expect(stalled).toBeLessThan(50_000)
    expect(meter.sample(1_000_000, 21_000)).toBeLessThan(stalled)
  })

  it('ignores samples in the same millisecond instead of dividing by zero', () => {
    const meter = createRateMeter()
    meter.sample(0, 0)
    meter.sample(1_000_000, 1000)
    const before = meter.bytesPerSecond()
    expect(meter.sample(1_500_000, 1000)).toBe(before)
    expect(Number.isFinite(meter.bytesPerSecond())).toBe(true)
  })

  it('weights by elapsed time, so a burst of fast callbacks does not dominate', () => {
    const fast = createRateMeter()
    fast.sample(0, 0)
    fast.sample(1_000_000, 1000)
    // Ten 1 ms callbacks moving nothing.
    for (let t = 1001; t <= 1010; t++) fast.sample(1_000_000, t)

    expect(fast.bytesPerSecond()).toBeGreaterThan(900_000)
  })
})
