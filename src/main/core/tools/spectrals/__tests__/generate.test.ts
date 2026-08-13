import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it } from 'vitest'
import { compressSpectralPngs } from '../compress'
import { generateSpectrals, type GenerateSpectralsOptions } from '../generate'

const roots: string[] = []
const pixels = Buffer.from([
  255, 0, 0, 255,
  0, 255, 0, 255,
  0, 0, 255, 255,
  255, 255, 255, 255
])

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('generateSpectrals', () => {
  it('runs no more than three track generations at once', async () => {
    const workspacePath = await workspace(5)
    let active = 0
    let maxActive = 0

    await generateSpectrals(workspacePath, {
      readDuration: async () => 10,
      run: async (_name, args) => {
        if (args[0] === '--i') return Buffer.from('10')
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 20))
        active--
        return Buffer.alloc(0)
      }
    })

    expect(maxActive).toBe(3)
  })

  it('keeps output numbers tied to source order when tracks finish out of order', async () => {
    const workspacePath = await workspace(3)
    const completed: string[] = []
    const outputs = new Map<string, string[]>()

    await generateSpectrals(workspacePath, {
      readDuration: async () => 10,
      run: async (_name, args) => {
        if (args[0] === '--i') return Buffer.from('10')
        const input = basename(args[1]!)
        const delay = input === '01.flac' ? 30 : input === '02.flac' ? 20 : 10
        outputs.set(
          input,
          args.flatMap((arg, index) => (arg === '-o' ? [basename(args[index + 1]!)] : []))
        )
        await new Promise((resolve) => setTimeout(resolve, delay))
        completed.push(input)
        return Buffer.alloc(0)
      }
    })

    expect(completed).toEqual(['03.flac', '02.flac', '01.flac'])
    expect(outputs.get('01.flac')).toEqual(['01 Full.png', '01 Zoom.png'])
    expect(outputs.get('02.flac')).toEqual(['02 Full.png', '02 Zoom.png'])
    expect(outputs.get('03.flac')).toEqual(['03 Full.png', '03 Zoom.png'])
  })
})

describe('compressSpectralPngs', () => {
  it('cleans up temporary files after an optimization failure', async () => {
    const root = await testRoot()
    const path = join(root, 'broken.png')
    await writeFile(path, 'not a PNG')

    await expect(compressSpectralPngs([path])).rejects.toThrow()
    expect((await readdir(root)).filter((entry) => entry.includes('.tmp'))).toEqual([])
  })

  it('does not leave temporary files when aborted', async () => {
    const root = await testRoot()
    const path = join(root, 'spectral.png')
    await writePng(path)
    const controller = new AbortController()
    controller.abort()

    await expect(compressSpectralPngs([path], controller.signal)).rejects.toMatchObject({
      name: 'AbortError'
    })
    expect((await readdir(root)).filter((entry) => entry.includes('.tmp'))).toEqual([])
  })
})

async function workspace(trackCount = 1): Promise<string> {
  const root = await testRoot()
  const workspacePath = join(root, 'release')
  await Promise.all(
    Array.from({ length: trackCount }, (_, index) =>
      writeFile(join(root, 'release', `${String(index + 1).padStart(2, '0')}.flac`), '')
    )
  )
  return workspacePath
}

async function testRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gravlax-spectral-test-'))
  roots.push(root)
  const workspacePath = join(root, 'release')
  await mkdir(workspacePath)
  return root
}

function spectralPath(workspacePath: string, name: string): string {
  return join(workspacePath, '..', 'Spectrals', name)
}

const spectralRunner: NonNullable<GenerateSpectralsOptions['run']> = async (name, args) => {
  if (name !== 'sox') throw new Error(`Unexpected command: ${name}`)
  if (args[0] === '--i') return Buffer.from('10')

  const outputs = args.flatMap((arg, index) => (arg === '-o' ? [args[index + 1]!] : []))
  await Promise.all(outputs.map(writePng))
  return Buffer.alloc(0)
}

async function writePng(path: string): Promise<void> {
  await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } })
    .withMetadata({ exif: { IFD0: { Artist: 'Gravlax' } } })
    .png()
    .toFile(path)
}
