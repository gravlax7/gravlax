import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertReleasePayloadReady,
  checkReleaseStructure,
  quarantineReleaseEntry,
  restoreQuarantinedReleaseEntry
} from '../structure'

let root = ''
let release = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-structure-'))
  release = join(root, 'Album')
  await mkdir(release, { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('release structure checks', () => {
  it('uses the release allowlist and requires a choice for other files', async () => {
    await writeFile(join(release, '01.FLAC'), 'audio')
    await writeFile(join(release, 'cover.JPG'), 'art')
    await writeFile(join(release, 'notes.json'), '{}')

    const pending = await checkReleaseStructure(release)
    expect(pending.issues).toMatchObject([
      { relativePath: 'notes.json', rule: 'suspicious-extension', canKeep: true, decision: 'pending' }
    ])
    const kept = await checkReleaseStructure(release, { approvedPaths: ['notes.json'] })
    expect(kept.ready).toBe(true)
    expect(kept.issues[0]?.decision).toBe('kept')
  })

  it('blocks links, @eaDir, and common non-FLAC audio without following them', async () => {
    await writeFile(join(release, '01.flac'), 'audio')
    await writeFile(join(release, 'bonus.wav'), 'audio')
    await mkdir(join(release, '@eaDir'), { recursive: true })
    await writeFile(join(release, '@eaDir', 'thumb.jpg'), 'image')
    await symlink(join(release, '01.flac'), join(release, 'linked.flac'))

    const result = await checkReleaseStructure(release)
    expect(result.issues.map((item) => [item.relativePath, item.rule])).toEqual([
      ['@eaDir', 'illegal-directory'],
      ['bonus.wav', 'mixed-audio'],
      ['linked.flac', 'symlink']
    ])
    expect(result.ready).toBe(false)
  })

  it('reports empty leaf folders as omitted', async () => {
    await mkdir(join(release, 'empty', 'nested'), { recursive: true })
    await writeFile(join(release, '01.flac'), 'audio')
    expect((await checkReleaseStructure(release)).emptyDirectories).toEqual(['empty/nested'])
  })

  it('quarantines and restores an item outside the payload', async () => {
    await mkdir(join(release, 'extras'), { recursive: true })
    await writeFile(join(release, 'extras', 'notes.json'), 'kept bytes')
    const issue = (await checkReleaseStructure(release)).issues[0]!
    const quarantined = await quarantineReleaseEntry(release, issue)
    await expect(lstat(join(release, 'extras'))).rejects.toMatchObject({ code: 'ENOENT' })

    await restoreQuarantinedReleaseEntry(release, quarantined)
    expect(await readFile(join(release, 'extras', 'notes.json'), 'utf8')).toBe('kept bytes')
  })

  it('enforces the final 180-character path using Unicode characters', async () => {
    await writeFile(join(release, 'é.flac'), 'audio')
    await expect(assertReleasePayloadReady(release)).resolves.toBeUndefined()
    const longName = `${'a'.repeat(180)}.flac`
    await writeFile(join(release, longName), 'audio')
    await expect(assertReleasePayloadReady(release)).rejects.toThrow('limit is 180')
  })
})
