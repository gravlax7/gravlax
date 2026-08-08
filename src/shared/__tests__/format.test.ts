import { describe, expect, it } from 'vitest'
import { etaSeconds, formatByteSize, formatEta, formatTransferRate } from '../format'

describe('formatByteSize', () => {
  it('keeps bytes whole and scales up from KiB', () => {
    expect(formatByteSize(512)).toBe('512 B')
    expect(formatByteSize(1024)).toBe('1.0 KiB')
    expect(formatByteSize(1536 * 1024 * 1024)).toBe('1.5 GiB')
  })
})

describe('formatTransferRate', () => {
  it('renders a per-second rate', () => {
    expect(formatTransferRate(18_400_000)).toBe('17.5 MiB/s')
    expect(formatTransferRate(1024)).toBe('1.0 KiB/s')
  })

  it('is empty while the rate is unknown', () => {
    expect(formatTransferRate(undefined)).toBe('')
    expect(formatTransferRate(0)).toBe('')
    expect(formatTransferRate(-5)).toBe('')
  })
})

describe('formatEta', () => {
  it('renders seconds, minutes and hours', () => {
    expect(formatEta(45)).toBe('45s')
    expect(formatEta(134)).toBe('2m 14s')
    expect(formatEta(120)).toBe('2m')
    expect(formatEta(3600)).toBe('1h')
    expect(formatEta(3900)).toBe('1h 5m')
  })

  it('is empty when unknown', () => {
    expect(formatEta(undefined)).toBe('')
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe('')
    expect(formatEta(-1)).toBe('')
  })
})

describe('etaSeconds', () => {
  it('divides what is left by the current rate', () => {
    expect(etaSeconds(0, 1000, 100)).toBe(10)
    expect(etaSeconds(500, 1000, 100)).toBe(5)
  })

  it('is zero once everything has moved', () => {
    expect(etaSeconds(1000, 1000, 100)).toBe(0)
  })

  it('is undefined without a total or a rate', () => {
    expect(etaSeconds(0, undefined, 100)).toBeUndefined()
    expect(etaSeconds(0, 1000, undefined)).toBeUndefined()
    expect(etaSeconds(0, 1000, 0)).toBeUndefined()
  })
})
