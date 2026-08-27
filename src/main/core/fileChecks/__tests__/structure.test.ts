import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  assertReleasePayloadReady,
  assertUploadFormatsReady,
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

    const pending = await checkReleaseStructure(release, { expectedFormat: 'FLAC' })
    expect(pending.issues).toMatchObject([
      { relativePath: 'notes.json', rule: 'suspicious-extension', canKeep: true, decision: 'pending' }
    ])
    const kept = await checkReleaseStructure(release, {
      expectedFormat: 'FLAC',
      approvedPaths: ['notes.json']
    })
    expect(kept.ready).toBe(true)
    expect(kept.issues[0]?.decision).toBe('kept')
  })

  it('ignores OS metadata but still flags other unknown files', async () => {
    await mkdir(join(release, 'CD1'), { recursive: true })
    await writeFile(join(release, '01.flac'), 'audio')
    await writeFile(join(release, '.DS_Store'), 'junk')
    await writeFile(join(release, 'THUMBS.DB'), 'junk')
    await writeFile(join(release, 'CD1', 'Desktop.Ini'), 'junk')
    await writeFile(join(release, 'CD1', '._01.flac'), 'junk')
    await writeFile(join(release, 'notes.json'), '{}')

    const blocked = await checkReleaseStructure(release, { expectedFormat: 'FLAC' })
    expect(blocked.ready).toBe(false)
    expect(blocked.issues).toMatchObject([
      { relativePath: 'notes.json', rule: 'suspicious-extension', decision: 'pending' }
    ])

    await rm(join(release, 'notes.json'))
    await expect(
      checkReleaseStructure(release, { expectedFormat: 'FLAC' })
    ).resolves.toMatchObject({ ready: true, issues: [] })
  })

  it('blocks links, @eaDir, and common non-FLAC audio without following them', async () => {
    await writeFile(join(release, '01.flac'), 'audio')
    await writeFile(join(release, 'bonus.wav'), 'audio')
    await mkdir(join(release, '@eaDir'), { recursive: true })
    await writeFile(join(release, '@eaDir', 'thumb.jpg'), 'image')
    await symlink(join(release, '01.flac'), join(release, 'linked.flac'))

    const result = await checkReleaseStructure(release, { expectedFormat: 'FLAC' })
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
    expect(
      (await checkReleaseStructure(release, { expectedFormat: 'FLAC' })).emptyDirectories
    ).toEqual(['empty/nested'])
  })

  it('quarantines and restores an item outside the payload', async () => {
    await mkdir(join(release, 'extras'), { recursive: true })
    await writeFile(join(release, 'extras', 'notes.json'), 'kept bytes')
    const issue = (await checkReleaseStructure(release, { expectedFormat: 'FLAC' })).issues[0]!
    const quarantined = await quarantineReleaseEntry(release, issue)
    await expect(lstat(join(release, 'extras'))).rejects.toMatchObject({ code: 'ENOENT' })

    await restoreQuarantinedReleaseEntry(release, quarantined)
    expect(await readFile(join(release, 'extras', 'notes.json'), 'utf8')).toBe('kept bytes')
  })

  it('enforces the final 180-character path using Unicode characters', async () => {
    await writeFile(join(release, 'é.flac'), 'audio')
    await expect(
      assertReleasePayloadReady(release, { expectedFormat: 'FLAC' })
    ).resolves.toBeUndefined()
    const longName = `${'a'.repeat(180)}.flac`
    await writeFile(join(release, longName), 'audio')
    await expect(
      assertReleasePayloadReady(release, { expectedFormat: 'FLAC' })
    ).rejects.toThrow('limit is 180')
  })

  it('checks audio files against the expected upload format', async () => {
    const mp3Release = join(root, 'Album [MP3 V0]')
    await mkdir(mp3Release)
    await writeFile(join(mp3Release, '01.mp3'), 'audio')
    await writeFile(join(mp3Release, 'cover.jpg'), 'art')

    await expect(
      assertReleasePayloadReady(mp3Release, { expectedFormat: 'MP3' })
    ).resolves.toBeUndefined()
    await expect(
      assertReleasePayloadReady(mp3Release, { expectedFormat: 'FLAC' })
    ).rejects.toThrow('audio does not match the declared FLAC format')

    await writeFile(join(mp3Release, 'bonus.flac'), 'audio')
    await expect(
      assertReleasePayloadReady(mp3Release, { expectedFormat: 'MP3' })
    ).rejects.toThrow('audio does not match the declared MP3 format')
    await writeFile(join(mp3Release, 'bonus.m4a'), 'audio')
    const issues = await checkReleaseStructure(mp3Release, { expectedFormat: 'MP3' })
    expect(issues.issues.map((item) => [item.relativePath, item.rule])).toEqual([
      ['bonus.flac', 'mixed-audio'],
      ['bonus.m4a', 'mixed-audio']
    ])
  })

  it('checks every prepared upload format as one preflight', async () => {
    const mp3Release = join(root, 'Album [MP3 V0]')
    await mkdir(mp3Release)
    await writeFile(join(release, '01.flac'), 'audio')
    await writeFile(join(mp3Release, '01.mp3'), 'audio')

    await expect(
      assertUploadFormatsReady([
        { folderPath: release, format: 'FLAC' },
        { folderPath: mp3Release, format: 'MP3' }
      ])
    ).resolves.toBeUndefined()

    await expect(
      assertUploadFormatsReady([{ folderPath: mp3Release, format: 'FLAC' }])
    ).rejects.toThrow('audio does not match the declared FLAC format')
  })
})
