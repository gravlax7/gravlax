import { describe, expect, it } from 'vitest'
import { parseIpcArguments } from '../ipc'

describe('IPC argument contract', () => {
  it('accepts a valid workflow transition index', () => {
    expect(parseIpcArguments('upload:setCurrentStep', [4])).toEqual([4])
  })

  it('rejects unknown workflow transition indexes', () => {
    expect(() => parseIpcArguments('upload:setCurrentStep', [99])).toThrow()
  })

  it('rejects malformed tracker commands before they reach a service', () => {
    expect(() => parseIpcArguments('upload:fetchTorrentGroup', ['other', 1])).toThrow()
    expect(() => parseIpcArguments('upload:fetchTorrentGroup', ['redacted', 0])).toThrow()
  })

  it('allows an omitted optional argument', () => {
    expect(parseIpcArguments('upload:searchTrackerGroups', [])).toEqual([])
  })
})
