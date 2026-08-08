import { readFile } from 'fs/promises'
import { homedir, userInfo } from 'os'
import { join } from 'path'
import { parseSalmonToml } from '@main/core/config/salmonToml'
import { expandPath } from '@main/core/config/paths'
import { parseRcloneConf, revealRclonePassword, type RcloneRemote } from '@shared/config/rcloneConf'
import type { RcloneSource, SalmonImportInput } from '@shared/config/salmonImport'

export type SalmonImportSourcesResult =
  | { ok: true; input: SalmonImportInput }
  | { ok: false; error: string }

/**
 * Reads the files an import plan is built from. Obscured rclone passwords are
 * revealed here so `node:crypto` stays out of the renderer bundle.
 */
export async function readSalmonImportSources(options: {
  tomlPath: string
  rcloneConfPath?: string
}): Promise<SalmonImportSourcesResult> {
  let text: string
  try {
    text = await readFile(expandPath(options.tomlPath).path, 'utf8')
  } catch (error) {
    return { ok: false, error: `Could not open ${options.tomlPath}: ${describe(error)}` }
  }

  const parsed = parseSalmonToml(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const input: SalmonImportInput = { toml: parsed.data }
  if (usesRclone(parsed.data)) {
    input.rclone = await readRcloneSource(options.rcloneConfPath)
  }
  return { ok: true, input }
}

function usesRclone(toml: Record<string, unknown>): boolean {
  const seedbox = toml['seedbox']
  if (!Array.isArray(seedbox)) return false
  return seedbox.some(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      (entry as Record<string, unknown>)['type'] === 'rclone'
  )
}

/** Where rclone looks for its config, in the order rclone itself checks. */
export function rcloneConfCandidates(): string[] {
  const candidates: string[] = []
  const explicit = process.env['RCLONE_CONFIG']
  if (explicit) candidates.push(explicit)
  const xdg = process.env['XDG_CONFIG_HOME']
  if (xdg) candidates.push(join(xdg, 'rclone', 'rclone.conf'))
  try {
    const home = homedir()
    candidates.push(join(home, '.config', 'rclone', 'rclone.conf'))
    candidates.push(join(home, '.rclone.conf'))
  } catch {
    // No home directory: the user can still browse for the file.
  }
  return candidates
}

async function readRcloneSource(explicitPath?: string): Promise<RcloneSource> {
  const candidates = explicitPath ? [explicitPath] : rcloneConfCandidates()
  for (const candidate of candidates) {
    let text: string
    try {
      text = await readFile(expandPath(candidate).path, 'utf8')
    } catch {
      continue
    }
    const parsed = parseRcloneConf(text)
    if (!parsed.ok) return { error: parsed.error, message: parsed.message }
    return { path: candidate, remotes: parsed.remotes.map(revealRemote), osUsername: localUsername() }
  }
  return {
    error: 'missing',
    message: explicitPath
      ? `Could not read ${explicitPath}.`
      : `Looked for rclone.conf in ${candidates.join(', ')} and found none.`
  }
}

function revealRemote(remote: RcloneRemote): RcloneRemote {
  const obscured = remote.values['pass']
  if (obscured === undefined) return remote
  const revealed = revealRclonePassword(obscured)
  if (revealed === null) {
    const { pass: _pass, ...rest } = remote.values
    return { ...remote, values: rest }
  }
  return { ...remote, values: { ...remote.values, pass: revealed } }
}

function localUsername(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
