import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type { VinylLineage } from '@shared/types'

const LINEAGE_EXTENSIONS = new Set(['.txt', '.nfo', '.log'])

/** Text files at the release folder root that could hold the lineage. */
export async function listLineageCandidates(root: string): Promise<string[]> {
  if (!root) return []
  try {
    const entries = await readdir(root, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && LINEAGE_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

/** The one candidate named as lineage, or null when there is none or several. */
export function pickLineageFile(candidates: readonly string[]): string | null {
  const named = candidates.filter((name) => name.toLowerCase().includes('lineage'))
  return named.length === 1 ? named[0]! : null
}

/**
 * Text for release descriptions only; the file itself is never changed.
 * UTF-16 when it starts with a UTF-16 BOM, otherwise UTF-8.
 */
export function readLineageText(buffer: Buffer): string {
  let text: string
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    text = buffer.subarray(2).toString('utf16le')
  } else if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    const even = buffer.length - (buffer.length % 2)
    text = Buffer.from(buffer.subarray(2, even)).swap16().toString('utf16le')
  } else {
    text = buffer.toString('utf8')
  }
  return text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').trimEnd()
}

export async function lineageText(
  workspacePath: string,
  lineage: VinylLineage | undefined
): Promise<string | undefined> {
  if (lineage?.kind === 'pasted') return readLineageText(Buffer.from(lineage.text))
  if (lineage?.kind !== 'file') return undefined
  return readLineageText(await readFile(join(workspacePath, lineage.path)))
}
