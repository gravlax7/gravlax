import { execFile } from 'node:child_process'
import type { ToolId } from './binaries'

const VERSION_ARGS: Record<ToolId, string[]> = {
  sox: ['--version'],
  flac: ['--version'],
  metaflac: ['--version'],
  lame: ['--version']
}

const VERSION_PATTERNS: Record<ToolId, RegExp> = {
  sox: /\b(SoX(?:_ng)?)\s+v?(\d+(?:\.\d+){1,3})\b/i,
  flac: /\b(flac)\s+v?(\d+(?:\.\d+){1,3})\b/i,
  metaflac: /\b(metaflac)\b(?:\s+v?|\s+[^\r\n]*?\bversion\s+v?)(\d+(?:\.\d+){1,3})\b/i,
  lame: /\b(LAME)\b.*?\bversion\s+v?(\d+(?:\.\d+){1,3})\b/i
}

export interface ToolVersion {
  product: string
  version: string
}

type VersionExecutor = (executable: string, args: string[]) => Promise<string>

export async function probeToolVersion(id: ToolId, executable: string, run: VersionExecutor = execute): Promise<ToolVersion> {
  const output = await run(executable, VERSION_ARGS[id])
  let parsed = parseToolVersion(id, output)
  if (!parsed && id === 'metaflac') {
    parsed = parseToolVersion(id, await run(executable, ['--help']))
  }
  if (!parsed) throw new Error(`Could not read ${id} version.`)
  return parsed
}

export function parseToolVersion(id: ToolId, output: string): ToolVersion | null {
  const match = VERSION_PATTERNS[id].exec(output)
  if (!match) return null
  const product = match[1]!
  return {
    product: product.toLowerCase() === 'sox_ng' ? 'SoX_ng' : displayProduct(id),
    version: match[2]!
  }
}

export function compareToolVersions(left: string, right: string): number {
  const a = numericParts(left)
  const b = numericParts(right)
  const length = Math.max(a.length, b.length)
  for (let index = 0; index < length; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0)
    if (difference !== 0) return difference
  }
  return 0
}

function numericParts(value: string): number[] {
  return value.split('.').map((part) => Number.parseInt(part, 10))
}

function displayProduct(id: ToolId): string {
  switch (id) {
    case 'sox':
      return 'SoX'
    case 'flac':
      return 'FLAC'
    case 'metaflac':
      return 'metaflac'
    case 'lame':
      return 'LAME'
  }
}

function execute(executable: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      args,
      { encoding: 'utf8', maxBuffer: 64 * 1024, timeout: 3000, windowsHide: true },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`.trim()
        if (!error) {
          resolve(output)
          return
        }
        reject(new Error(output || error.message))
      }
    )
  })
}
