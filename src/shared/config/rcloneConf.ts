import { createDecipheriv } from 'node:crypto'

/**
 * rclone.conf is an INI file: `[remote]` sections of `key = value` lines. This
 * reads it well enough to resolve the sftp remote a smoked-salmon seedbox
 * points at. Node-side only — `revealPassword` needs `node:crypto`.
 */
export interface RcloneRemote {
  name: string
  type: string
  values: Record<string, string>
}

export type RcloneConfResult =
  | { ok: true; remotes: RcloneRemote[] }
  | { ok: false; error: 'encrypted' | 'malformed'; message: string }

const SECTION = /^\[(.+)\]$/

export function parseRcloneConf(text: string): RcloneConfResult {
  if (text.includes('RCLONE_ENCRYPT_V0')) {
    return {
      ok: false,
      error: 'encrypted',
      message: 'This rclone config is password-protected, so Gravlax cannot read it.'
    }
  }

  const remotes: RcloneRemote[] = []
  let current: RcloneRemote | undefined

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#') || line.startsWith(';')) continue

    const section = SECTION.exec(line)
    if (section) {
      current = { name: section[1]!.trim(), type: '', values: {} }
      remotes.push(current)
      continue
    }

    const separator = line.indexOf('=')
    if (separator === -1) continue
    if (!current) {
      return { ok: false, error: 'malformed', message: 'Found a setting before any [remote] header.' }
    }

    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (key === '') continue
    current.values[key] = value
    if (key === 'type') current.type = value
  }

  return { ok: true, remotes }
}

export function findRcloneRemote(remotes: RcloneRemote[], name: string): RcloneRemote | undefined {
  return remotes.find((remote) => remote.name === name)
}

// rclone's fs/config/obscure: AES-256-CTR, IV in the first block, base64url.
// Verified against `rclone obscure` output — see rcloneConf.test.ts.
const OBSCURE_KEY = Buffer.from([
  0x9c, 0x93, 0x5b, 0x48, 0x73, 0x0a, 0x55, 0x4d,
  0x6b, 0xfd, 0x7c, 0x63, 0xc8, 0x86, 0xa9, 0x2b,
  0xd3, 0x90, 0x19, 0x8e, 0xb8, 0x12, 0x8a, 0xfb,
  0xf4, 0xde, 0x16, 0x2b, 0x8b, 0x95, 0xf6, 0x38
])
const IV_LENGTH = 16

/** Returns null when the value is not a well-formed obscured password. */
export function revealRclonePassword(obscured: string): string | null {
  if (obscured === '') return null
  let raw: Buffer
  try {
    raw = Buffer.from(obscured, 'base64url')
  } catch {
    return null
  }
  if (raw.length < IV_LENGTH) return null
  try {
    const decipher = createDecipheriv('aes-256-ctr', OBSCURE_KEY, raw.subarray(0, IV_LENGTH))
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_LENGTH)), decipher.final()])
    return plain.toString('utf8')
  } catch {
    return null
  }
}
