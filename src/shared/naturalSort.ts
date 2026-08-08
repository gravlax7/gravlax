/**
 * Compares two strings the way a human orders filenames: runs of digits
 * compare by numeric value, everything else compares as text.
 *
 * Without this, `localeCompare`/codepoint order puts "CD10" before "CD2" and
 * "10 - Track.flac" before "2 - Track.flac" — the wrong order for any
 * multi-disc or double-digit-track release, and every consumer of file
 * discovery order (tracklists, spectral numbering, duration pairing) inherits
 * the mistake.
 */
export function compareNatural(a: string, b: string): number {
  const left = tokenize(a)
  const right = tokenize(b)
  const length = Math.min(left.length, right.length)
  for (let i = 0; i < length; i++) {
    const l = left[i]!
    const r = right[i]!
    if (typeof l === 'number' && typeof r === 'number') {
      if (l !== r) return l - r
      continue
    }
    const ls = String(l)
    const rs = String(r)
    if (ls !== rs) return ls < rs ? -1 : 1
  }
  return left.length - right.length
}

function tokenize(value: string): Array<string | number> {
  const tokens: Array<string | number> = []
  const re = /\d+|\D+/g
  let match: RegExpExecArray | null
  while ((match = re.exec(value)) !== null) {
    const chunk = match[0]!
    tokens.push(/^\d+$/.test(chunk) ? Number.parseInt(chunk, 10) : chunk)
  }
  return tokens
}
