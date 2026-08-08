import { parse } from 'smol-toml'

export type SalmonTomlResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; error: string }

/** Pure over the file text so it can be tested without touching disk. */
export function parseSalmonToml(text: string): SalmonTomlResult {
  let data: unknown
  try {
    data = parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: `Could not read the TOML file: ${message}` }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'The TOML file did not contain a table of settings.' }
  }
  return { ok: true, data: data as Record<string, unknown> }
}
