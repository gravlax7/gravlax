import { describe, expect, it } from 'vitest'
import {
  isSafeQBittorrentURL,
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

describe('qBittorrent WebUI URLs', () => {
  it('keeps private LAN HTTP disabled by default', () => {
    expect(isSafeQBittorrentURL('http://192.168.1.20:8080')).toBe(false)
    expect(isSafeQBittorrentURL('http://192.168.1.20:8080', false)).toBe(false)
  })

  it.each([
    'http://10.0.0.2:8080',
    'http://172.16.0.2:8080',
    'http://172.31.255.254:8080',
    'http://192.168.1.20:8080',
    'http://[fc00::2]:8080',
    'http://[fd12:3456::2]:8080'
  ])('allows private LAN HTTP after opt-in: %s', (url) => {
    expect(isSafeQBittorrentURL(url, true)).toBe(true)
  })

  it.each([
    'http://172.15.0.2:8080',
    'http://172.32.0.2:8080',
    'http://192.169.1.20:8080',
    'http://100.64.0.2:8080',
    'http://qbit.lan:8080',
    'http://fc.example:8080',
    'http://[2001:db8::2]:8080'
  ])('still rejects non-private HTTP after opt-in: %s', (url) => {
    expect(isSafeQBittorrentURL(url, true)).toBe(false)
  })

  it('always allows loopback HTTP and valid HTTPS', () => {
    expect(isSafeQBittorrentURL('http://127.0.0.1:8080')).toBe(true)
    expect(isSafeQBittorrentURL('https://qbit.example')).toBe(true)
  })
})
