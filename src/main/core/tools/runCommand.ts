import { spawn } from 'node:child_process'
import { automaticToolResolver, type ToolId, type ToolResolver } from './binaries'

// stdout and stderr are kept apart: callers parse stdout (sox --i -D prints a
// bare duration there), and folding in a warning would break that parse.
export async function runCommand(
  name: ToolId,
  args: string[],
  signal?: AbortSignal,
  input?: string | Uint8Array,
  tools: ToolResolver = automaticToolResolver
): Promise<Buffer> {
  const executable = await tools.require(name)
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { signal })
    const out: Buffer[] = []
    const err: Buffer[] = []
    child.stdout.on('data', (c: Buffer) => out.push(c))
    child.stderr.on('data', (c: Buffer) => err.push(c))
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
    child.on('error', reject)
    child.on('close', (code) => {
      if (code === 0) {
        resolve(Buffer.concat(out))
        return
      }
      const trimmed = Buffer.concat(err).toString('utf8').trim()
      reject(new Error(trimmed || `command failed: ${name}`))
    })
  })
}
