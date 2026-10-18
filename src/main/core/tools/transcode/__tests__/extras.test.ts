import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { copyExtraFiles, SKIP_EXTENSIONS } from '../extras'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('copyExtraFiles', () => {
  it('copies the lineage file byte for byte even when only essentials are copied', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gravlax-extras-'))
    dirs.push(root)
    const source = join(root, 'source')
    const dest = join(root, 'dest')
    await mkdir(source)
    const lineage = Buffer.from('﻿Turntable\r\nCartridge\r\n', 'utf16le')
    await writeFile(join(source, 'Lineage.log'), lineage)
    await writeFile(join(source, 'notes.txt'), 'notes')
    await writeFile(join(source, 'cover.jpg'), 'jpg')

    const copied = await copyExtraFiles(source, dest, {
      essentialOnly: true,
      skipExtensions: SKIP_EXTENSIONS,
      alwaysCopy: new Set(['Lineage.log'])
    })

    expect(copied.filter((item) => item.action === 'copy').map((item) => item.relativePath).sort())
      .toEqual(['Lineage.log', 'cover.jpg'])
    expect((await readFile(join(dest, 'Lineage.log'))).equals(lineage)).toBe(true)
  })
})
