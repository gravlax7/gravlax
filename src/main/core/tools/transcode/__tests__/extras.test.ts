import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyExtraFiles } from '../extras'
import { SKIP_EXTENSIONS } from '../audioInfo'

const FILES = [
  'cover.jpg',
  'info.txt',
  'rip.log',
  'CD1/01.flac',
  'CD1/cover.png',
  'CD1/Scans/back.jpg',
  'CD2/01.flac',
  'Artwork/booklet.pdf',
  'Artwork/front.jpg',
  'Artwork/Inner/tray.png'
]

let root: string
let src: string
let dst: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-extras-'))
  src = join(root, 'src')
  dst = join(root, 'dst')
  for (const file of FILES) {
    await mkdir(dirname(join(src, file)), { recursive: true })
    await writeFile(join(src, file), '')
  }
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function listed(): Promise<string[]> {
  const entries = await readdir(dst, { recursive: true, withFileTypes: true })
  return entries
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name).slice(dst.length + 1))
    .sort()
}

describe('copyExtraFiles', () => {
  it('drops folders without audio when essential only', async () => {
    await copyExtraFiles(src, dst, {
      essentialOnly: true,
      skipFlac: true,
      skipExtensions: SKIP_EXTENSIONS
    })
    expect(await listed()).toEqual(['CD1/cover.png', 'cover.jpg'])
  })

  it('copies everything else when not essential only', async () => {
    await copyExtraFiles(src, dst, { skipFlac: true, skipExtensions: SKIP_EXTENSIONS })
    expect(await listed()).toEqual([
      'Artwork/Inner/tray.png',
      'Artwork/booklet.pdf',
      'Artwork/front.jpg',
      'CD1/Scans/back.jpg',
      'CD1/cover.png',
      'cover.jpg',
      'info.txt'
    ])
  })
})
