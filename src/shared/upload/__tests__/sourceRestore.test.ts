import { describe, expect, it } from 'vitest'
import { sourceRestoreUnavailableMessage } from '../sourceRestore'

describe('sourceRestoreUnavailableMessage', () => {
  it('explains why restore is unavailable', () => {
    expect(sourceRestoreUnavailableMessage('moved')).toBe('The source folder was moved or deleted.')
    expect(sourceRestoreUnavailableMessage('changed')).toBe('The source folder has changed.')
    expect(sourceRestoreUnavailableMessage('unknown')).toBe('This workspace cannot be restored.')
  })
})
