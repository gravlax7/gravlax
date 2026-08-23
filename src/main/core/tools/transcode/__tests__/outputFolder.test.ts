import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { inspectOutputFolder } from '../outputFolder'

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true }))
  )
})

describe('inspectOutputFolder', () => {
  it('distinguishes missing, partial, and complete nested output', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gravlax-output-'))
    temporaryPaths.push(root)
    const output = join(root, 'MP3 V0')
    const expected = [join(output, 'CD1', '01.mp3'), join(output, 'CD2', '01.mp3')]

    await expect(inspectOutputFolder(output, expected, '.mp3')).resolves.toBe('missing')

    await mkdir(join(output, 'CD1'), { recursive: true })
    await writeFile(expected[0]!, '')
    await expect(inspectOutputFolder(output, expected, '.mp3')).resolves.toBe('partial')

    await mkdir(join(output, 'CD2'), { recursive: true })
    await writeFile(expected[1]!, '')
    await expect(inspectOutputFolder(output, expected, '.mp3')).resolves.toBe('complete')
  })
})
