import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
  it('leaves generated PNGs alone when compression is disabled', async () => {
    const workspacePath = await workspace()
    let compressed = false
    await generateSpectrals(workspacePath, {
      run: spectralRunner,
      onCompress: () => {
        compressed = true
      }
    })

    expect(compressed).toBe(false)
    const metadata = await sharp(spectralPath(workspacePath, '01 Full.png')).metadata()
    expect(metadata.exif).toBeDefined()
  })

  it('losslessly compresses every generated full and zoom PNG before completion', async () => {
    const workspacePath = await workspace()
    let compressed = false
    await generateSpectrals(workspacePath, {
      compress: true,
      run: spectralRunner,
      onCompress: () => {
        compressed = true
      }
    })

    expect(compressed).toBe(true)
    for (const name of ['01 Full.png', '01 Zoom.png']) {
      const image = sharp(spectralPath(workspacePath, name))
      const [metadata, raw] = await Promise.all([image.metadata(), image.raw().toBuffer()])
      expect(metadata.width).toBe(2)
      expect(metadata.height).toBe(2)
      expect(metadata.isPalette).toBe(false)
      expect(metadata.exif).toBeUndefined()
      expect(raw).toEqual(pixels)
    }
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

async function workspace(): Promise<string> {
  const root = await testRoot()
  const workspacePath = join(root, 'release')
  await writeFile(join(root, 'release', '01.flac'), '')
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
