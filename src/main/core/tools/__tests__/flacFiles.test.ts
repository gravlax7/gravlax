import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { discoverFLACFiles } from '../flacFiles'

let root = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-flac-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('discoverFLACFiles', () => {
  it('orders multi-disc folders naturally, not lexicographically', async () => {
    for (const disc of ['CD1', 'CD2', 'CD10']) {
      await mkdir(join(root, disc), { recursive: true })
      await writeFile(join(root, disc, '01.flac'), 'x')
    }

    const files = await discoverFLACFiles(root)
    expect(files.map((f) => f.relativePath)).toEqual(['CD1/01.flac', 'CD2/01.flac', 'CD10/01.flac'])
  })

  it('orders double-digit track numbers naturally within a folder', async () => {
    for (const name of ['1 - a.flac', '2 - b.flac', '10 - c.flac']) {
      await writeFile(join(root, name), 'x')
    }

    const files = await discoverFLACFiles(root)
    expect(files.map((f) => f.relativePath)).toEqual(['1 - a.flac', '2 - b.flac', '10 - c.flac'])
  })
})
