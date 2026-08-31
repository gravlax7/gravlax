import { describe, expect, it } from 'vitest'
import {
  isTrackerHost,
  normalizeTrackerHost,
  trackerHTTPSURL
} from '@shared/config/network'

describe('tracker hosts', () => {
  it.each([
    ['tracker.example', 'tracker.example'],
    ['  Tracker.Example  ', 'tracker.example'],
    ['https://tracker.example', 'tracker.example'],
    ['http://tracker.example/', 'tracker.example'],
    ['https://tracker.example:443/path', 'tracker.example:443'],
    ['https://tracker.example:8443/path?query=yes#part', 'tracker.example:8443'],
    [
      'https://announce.example/private-passkey/announce',
      'announce.example'
    ]
  ])('normalizes %s', (input, expected) => {
    expect(normalizeTrackerHost(input)).toBe(expected)
  })

  it.each([
    'tracker.example',
    'tracker.example:8443',
    '[2001:db8::1]',
    '[2001:db8::1]:8443'
  ])('accepts the canonical host %s', (host) => {
    expect(isTrackerHost(host)).toBe(true)
  })

  it.each([
    '',
    ' tracker.example',
    'Tracker.Example',
    'https://tracker.example',
    'tracker.example/path',
    'tracker.example?query=yes',
    'tracker.example#part',
    'tracker example',
    'ftp://tracker.example'
  ])('rejects the non-canonical host %s', (host) => {
    expect(isTrackerHost(host)).toBe(false)
  })

  it('builds an HTTPS URL from either new or old config input', () => {
    expect(trackerHTTPSURL('tracker.example:8443')).toBe('https://tracker.example:8443')
    expect(trackerHTTPSURL('http://Tracker.Example/old/path')).toBe(
      'https://tracker.example'
    )
    expect(trackerHTTPSURL('ftp://tracker.example')).toBe('')
  })
})
