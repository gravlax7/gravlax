import { describe, expect, it } from 'vitest'
import { hostKeyFingerprint } from '../sftp'

describe('hostKeyFingerprint', () => {
  it('matches the OpenSSH SHA256 format', () => {
    // `printf 'gravlax' | openssl dgst -binary -sha256 | openssl base64`
    expect(hostKeyFingerprint(Buffer.from('gravlax'))).toBe(
      'SHA256:XE8jVdKwDIMa8xQAYPgZQ6bcc9tnVkbuNPReM3R7b6w'
    )
  })

  it('strips base64 padding the way ssh-keygen does', () => {
    expect(hostKeyFingerprint(Buffer.from('anything'))).not.toMatch(/=/)
  })

  it('distinguishes different host keys', () => {
    expect(hostKeyFingerprint(Buffer.from('key-a'))).not.toBe(
      hostKeyFingerprint(Buffer.from('key-b'))
    )
  })
})
