import { describe, expect, it } from 'vitest'
import { parseRcloneConf, revealRclonePassword } from '@shared/config/rcloneConf'

describe('parseRcloneConf', () => {
  it('reads remotes, ignoring comments and blank lines', () => {
    const result = parseRcloneConf(
      [
        '# rclone config',
        '',
        '[nas]',
        'type = sftp',
        'host = seedbox.example.com',
        'user = uploader',
        '; a comment',
        'port = 2222',
        '',
        '[backup]',
        'type = s3',
        'provider = AWS'
      ].join('\n')
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.remotes.map((remote) => remote.name)).toEqual(['nas', 'backup'])
    const nas = result.remotes[0]!
    expect(nas.type).toBe('sftp')
    expect(nas.values).toEqual({
      type: 'sftp',
      host: 'seedbox.example.com',
      user: 'uploader',
      port: '2222'
    })
    expect(result.remotes[1]!.type).toBe('s3')
  })

  it('keeps values that contain an equals sign intact', () => {
    const result = parseRcloneConf('[nas]\ntype = sftp\npass = abc=def=\n')
    expect(result.ok && result.remotes[0]!.values['pass']).toBe('abc=def=')
  })

  it('reports a password-protected config instead of returning junk', () => {
    const result = parseRcloneConf(
      '# Encrypted rclone configuration File\n\nRCLONE_ENCRYPT_V0:c29tZXRoaW5n\n'
    )
    expect(result).toMatchObject({ ok: false, error: 'encrypted' })
  })

  it('rejects settings that appear before any remote header', () => {
    expect(parseRcloneConf('type = sftp\n')).toMatchObject({ ok: false, error: 'malformed' })
  })

  it('returns no remotes for an empty file', () => {
    expect(parseRcloneConf('')).toEqual({ ok: true, remotes: [] })
  })
})

describe('revealRclonePassword', () => {
  // Literals produced by `rclone obscure <value>` (rclone v1.7x).
  it('reveals passwords obscured by rclone', () => {
    expect(revealRclonePassword('Kw0swBA5HKtLhzCIGguI2jVwaaQSU58')).toBe('hunter2')
    expect(revealRclonePassword('sUja26YRiMPpFCRmuHx87D-aF3E1jDq6CoE')).toBe('p@ss w0rd!')
    expect(revealRclonePassword('wHjZNy-kNqkYMsO49VAWmg')).toBe('')
  })

  it('returns null for values that are not obscured passwords', () => {
    expect(revealRclonePassword('')).toBeNull()
    expect(revealRclonePassword('short')).toBeNull()
  })
})
