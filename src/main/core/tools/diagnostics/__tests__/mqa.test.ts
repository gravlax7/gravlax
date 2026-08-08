import { describe, expect, it } from 'vitest'
import { checkMQASyncword, plantSyncword } from '../mqa'

describe('MQA syncword detection', () => {
  it('detects planted syncword at every bit position 16-23', () => {
    for (let bit = 16; bit < 24; bit++) {
      const { left, right } = plantSyncword(64, bit, 0, false)
      expect(checkMQASyncword(left, right), `bit ${bit}`).toBe(true)
    }
  })

  it('detects planted syncword with negative XOR', () => {
    for (let bit = 16; bit < 24; bit++) {
      const { left, right } = plantSyncword(64, bit, 4, true)
      expect(checkMQASyncword(left, right), `negative bit ${bit}`).toBe(true)
    }
  })

  it('returns false for clean buffer', () => {
    const left = new Int32Array(64)
    const right = new Int32Array(64)
    expect(checkMQASyncword(left, right)).toBe(false)
  })
})
