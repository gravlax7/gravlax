import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline/promises'

const releaseTypes = ['patch', 'minor', 'major'] as const
type ReleaseType = (typeof releaseTypes)[number]

const releaseType = process.argv[2]

if (!releaseTypes.includes(releaseType as ReleaseType)) {
  console.error(`Usage: bun run release <${releaseTypes.join('|')}>`)
  process.exit(1)
}

const readline = createInterface({
  input: process.stdin,
  output: process.stdout
})

const answer = await readline.question(
  `Release a new ${releaseType} version and push its tag? [y/N] `
)
readline.close()

if (!['y', 'yes'].includes(answer.trim().toLowerCase())) {
  console.log('Release cancelled.')
  process.exit(0)
}

async function run(command: string, args: string[]): Promise<void> {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' })

    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) {
        resolve(undefined)
      } else {
        reject(new Error(`${command} exited with code ${code ?? 'unknown'}`))
      }
    })
  })
}

await run('npm', ['version', releaseType])
await run('git', ['push', '--follow-tags'])
