import { describe, expect, it } from 'vitest'
import { pieceSizeBytes } from '../pieceSize'

describe('pieceSizeBytes', () => {
  it('leaves Auto to the release size', () => {
    expect(pieceSizeBytes('Auto')).toBeUndefined()
  })

  it('converts fixed sizes to bytes', () => {
    expect(pieceSizeBytes('16 KiB')).toBe(16 * 1024)
    expect(pieceSizeBytes('1 MiB')).toBe(1024 * 1024)
    expect(pieceSizeBytes('16 MiB')).toBe(16 * 1024 * 1024)
  })
})
