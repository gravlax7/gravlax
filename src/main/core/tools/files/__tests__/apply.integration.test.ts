import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { writeSyntheticFlac } from '../../__tests__/helpers/audioFixture'
import { runCommand } from '../../runCommand'
import { extractAlbumReleaseWithEmbeddedCoverArt } from '../../../tags/extract'
import { applyTagsAndRenames } from '../apply'

async function binaryAvailable(name: string): Promise<boolean> {
  for (const part of (process.env.PATH ?? '').split(delimiter)) {
    try { await access(join(part, name)); return true } catch { /* continue */ }
  }
  return false
}

describe('tag and filename writes', () => {
  it('writes through metaflac, strips pictures, and renames', async () => {
    if (!(await binaryAvailable('metaflac')) || !(await binaryAvailable('flac'))) return
    const root = await mkdtemp(join(tmpdir(), 'gravlax-tags-'))
    try {
      const album = join(root, 'Old Album')
      const source = join(album, 'old.flac')
      await mkdir(album)
      await writeSyntheticFlac(source)
      await writeFile(join(root, '.gravlax-upload.json'), JSON.stringify({ sourcePath: album, stagedName: 'Old Album' }))
      const image = join(root, 'cover.png')
      await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
      await runCommand('metaflac', ['--remove-tag=TITLE', '--set-tag=TITLE=Old title', '--set-tag=ISRC=KEEP', '--set-tag=COVERART=LEGACYDATA', '--set-tag=COVERARTMIME=image/png', `--import-picture-from=${image}`, source])

      const applyProgress: Array<{ current: number; total: number; label: string }> = []
      const result = await applyTagsAndRenames({
        workspacePath: album,
        release: {
          title: 'New Album',
          editionTitle: 'Deluxe Edition',
          groupYear: '2018-09-21',
          year: '2024',
          albumArtist: 'Artist',
          upc: '012345678901',
          comment: 'Line one\nLine two',
          tracks: [{ title: 'New title', trackNumber: '1', discNumber: '1', artists: [{ name: 'Artist', role: 'main' }] }]
        },
        plan: { folderName: 'Artist - New Album', files: [{ id: 'track-1', currentPath: 'old.flac', targetPath: '01. New title.flac', targetFilename: '01. New title.flac', changed: true }], errors: [], warnings: [], hash: 'test' },
        stripEmbeddedCoverArt: true,
        onProgress: (current, total, label) =>
          applyProgress.push({ current, total, label })
      })
      expect(applyProgress).toContainEqual({ current: 1, total: 2, label: 'Renaming files…' })
      expect(applyProgress.at(-1)).toEqual({ current: 2, total: 2, label: 'Finishing…' })
      expect(result.strippedPictureCount).toBeGreaterThan(0)
      const changed = join(result.workspacePath, '01. New title.flac')
      expect((await runCommand('metaflac', ['--show-tag=TITLE', changed])).toString()).toContain('TITLE=New title')
      expect((await runCommand('metaflac', ['--show-tag=ALBUM', changed])).toString()).toContain('ALBUM=New Album')
      expect((await runCommand('metaflac', ['--show-tag=EDITIONTITLE', changed])).toString()).toContain('EDITIONTITLE=Deluxe Edition')
      expect((await runCommand('metaflac', ['--show-tag=DATE', changed])).toString()).toContain('DATE=2024')
      expect((await runCommand('metaflac', ['--show-tag=ORIGINALDATE', changed])).toString()).toContain('ORIGINALDATE=2018-09-21')
      expect((await runCommand('metaflac', ['--show-tag=YEAR', changed])).toString()).not.toContain('YEAR=')
      expect((await runCommand('metaflac', ['--show-tag=BARCODE', changed])).toString()).toContain('BARCODE=012345678901')
      expect((await runCommand('metaflac', ['--show-tag=UPC', changed])).toString()).toContain('UPC=012345678901')
      expect((await runCommand('metaflac', ['--show-tag=ISRC', changed])).toString()).toContain('ISRC=KEEP')
      expect((await runCommand('metaflac', ['--show-tag=COMMENT', changed])).toString()).toContain('Line one\nLine two')
      expect((await runCommand('metaflac', ['--list', changed])).toString()).not.toContain('(PICTURE)')
      expect((await runCommand('metaflac', ['--show-tag=COVERART', changed])).toString()).toBe('')
      await runCommand('flac', ['-t', '--silent', changed])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('round-trips role credits and preserves unmanaged comments and cover data', async () => {
    if (!(await binaryAvailable('metaflac')) || !(await binaryAvailable('flac'))) return
    const root = await mkdtemp(join(tmpdir(), 'gravlax-role-tags-'))
    try {
      const album = join(root, 'Album')
      const source = join(album, 'track.flac')
      await mkdir(album)
      await writeSyntheticFlac(source)
      await writeFile(join(root, '.gravlax-upload.json'), JSON.stringify({ sourcePath: album, stagedName: 'Album' }))
      const image = join(root, 'cover.png')
      await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
      await runCommand('metaflac', [
        '--remove-tag=ARTIST',
        '--set-tag=ARTIST=Adele',
        '--set-tag=COMPOSER=Adele',
        '--set-tag=COMPOSER=Bach, Johann Sebastian',
        '--set-tag=CONDUCTOR=Maestro',
        '--set-tag=ISRC=GB-ABC-12-34567',
        '--set-tag=REPLAYGAIN_TRACK_GAIN=-7.00 dB',
        '--set-tag=REPLAYGAIN_TRACK_PEAK=0.9876',
        '--set-tag=REPLAYGAIN_ALBUM_GAIN=-6.00 dB',
        '--set-tag=REPLAYGAIN_ALBUM_PEAK=0.9999',
        '--set-tag=X-GRAVLAX-TEST=keep me',
        '--set-tag=PUBLISHER=Keep Publisher',
        '--set-tag=EDITIONTITLE=Deluxe',
        '--set-tag=COVERART=LEGACYDATA',
        '--set-tag=COVERARTMIME=image/png',
        `--import-picture-from=${image}`,
        source
      ])

      const plan = {
        folderName: 'Album',
        files: [{
          id: 'track-1',
          currentPath: 'track.flac',
          targetPath: 'track.flac',
          targetFilename: 'track.flac',
          changed: false
        }],
        errors: [],
        warnings: [],
        hash: 'roles'
      }
      const release = {
        title: 'Album',
        albumArtist: 'Adele',
        tracks: [{
          title: 'Song',
          trackNumber: '1',
          discNumber: '1',
          artists: [
            { name: 'Adele', role: 'main' },
            { name: 'Adele', role: 'composer' },
            { name: 'Bach, Johann Sebastian', role: 'composer' },
            { name: 'Maestro', role: 'conductor' }
          ]
        }]
      }

      await applyTagsAndRenames({
        workspacePath: album,
        release,
        plan,
        stripEmbeddedCoverArt: false
      })

      expect(await tagLines(source, 'COMPOSER')).toEqual([
        'COMPOSER=Adele',
        'COMPOSER=Bach, Johann Sebastian'
      ])
      expect(await tagLines(source, 'CONDUCTOR')).toEqual(['CONDUCTOR=Maestro'])
      expect(await tagLines(source, 'ARTISTS')).toEqual(['ARTISTS=Adele'])
      expect(await tagLines(source, 'ISRC')).toEqual(['ISRC=GB-ABC-12-34567'])
      expect(await tagLines(source, 'REPLAYGAIN_TRACK_GAIN')).toEqual([
        'REPLAYGAIN_TRACK_GAIN=-7.00 dB'
      ])
      expect(await tagLines(source, 'REPLAYGAIN_TRACK_PEAK')).toEqual([
        'REPLAYGAIN_TRACK_PEAK=0.9876'
      ])
      expect(await tagLines(source, 'REPLAYGAIN_ALBUM_GAIN')).toEqual([
        'REPLAYGAIN_ALBUM_GAIN=-6.00 dB'
      ])
      expect(await tagLines(source, 'REPLAYGAIN_ALBUM_PEAK')).toEqual([
        'REPLAYGAIN_ALBUM_PEAK=0.9999'
      ])
      expect(await tagLines(source, 'X-GRAVLAX-TEST')).toEqual([
        'X-GRAVLAX-TEST=keep me'
      ])
      expect(await tagLines(source, 'PUBLISHER')).toEqual(['PUBLISHER=Keep Publisher'])
      expect(await tagLines(source, 'EDITIONTITLE')).toEqual([])
      expect(await tagLines(source, 'COVERART')).toEqual(['COVERART=LEGACYDATA'])
      expect((await runCommand('metaflac', ['--list', source])).toString()).toContain('(PICTURE)')

      const extracted = await extractAlbumReleaseWithEmbeddedCoverArt(source)
      expect(extracted.release.tracks?.[0]?.artists).toEqual([
        { name: 'Adele', role: 'main' },
        { name: 'Adele', role: 'composer' },
        { name: 'Bach, Johann Sebastian', role: 'composer' },
        { name: 'Maestro', role: 'conductor' }
      ])

      await applyTagsAndRenames({
        workspacePath: album,
        release: {
          ...release,
          tracks: [{ ...release.tracks[0], artists: [{ name: 'Adele', role: 'main' }] }]
        },
        plan,
        stripEmbeddedCoverArt: false
      })
      expect(await tagLines(source, 'COMPOSER')).toEqual([])
      expect(await tagLines(source, 'CONDUCTOR')).toEqual([])

      await applyTagsAndRenames({
        workspacePath: album,
        release: {
          ...release,
          tracks: [{ ...release.tracks[0], artists: [{ name: 'Adele', role: 'composer' }] }]
        },
        plan,
        stripEmbeddedCoverArt: false
      })
      expect(await tagLines(source, 'ARTIST')).toEqual(['ARTIST=Adele'])
      expect(await tagLines(source, 'COVERART')).toEqual(['COVERART=LEGACYDATA'])
      expect((await runCommand('metaflac', ['--list', source])).toString()).toContain('(PICTURE)')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('rewrites a near-limit filename before giving it a shorter name', async () => {
    if (!(await binaryAvailable('metaflac')) || !(await binaryAvailable('flac'))) return
    const root = await mkdtemp(join(tmpdir(), 'gravlax-long-name-'))
    try {
      const album = join(root, 'Album')
      const longFilename = `${'a'.repeat(240)}.flac`
      const source = join(album, longFilename)
      await mkdir(album)
      await writeSyntheticFlac(source)
      await writeFile(
        join(root, '.gravlax-upload.json'),
        JSON.stringify({ sourcePath: album, stagedName: 'Album' })
      )

      const result = await applyTagsAndRenames({
        workspacePath: album,
        release: { title: 'Album', tracks: [{ title: 'Phe\u0301nix', trackNumber: '1' }] },
        plan: {
          folderName: 'Album',
          files: [{
            id: 'track-1',
            currentPath: longFilename,
            targetPath: '01. Short.flac',
            targetFilename: '01. Short.flac',
            changed: true
          }],
          errors: [],
          warnings: [],
          hash: 'long-name'
        },
        stripEmbeddedCoverArt: true
      })

      const renamed = join(result.workspacePath, '01. Short.flac')
      await expect(access(renamed)).resolves.toBeUndefined()
      expect((await runCommand('metaflac', ['--show-tag=TITLE', renamed])).toString()).toContain(
        'TITLE=Ph\u00e9nix'
      )
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('moves disc sidecars with their tracks', async () => {
    if (!(await binaryAvailable('metaflac')) || !(await binaryAvailable('flac'))) return
    const root = await mkdtemp(join(tmpdir(), 'gravlax-sidecars-'))
    try {
      const album = join(root, 'Album')
      await mkdir(join(album, 'CD1'), { recursive: true })
      await mkdir(join(album, 'CD2'), { recursive: true })
      await writeSyntheticFlac(join(album, 'CD1', 'a.flac'))
      await copyFile(join(album, 'CD1', 'a.flac'), join(album, 'CD2', 'b.flac'))
      await writeFile(join(album, 'CD1', 'rip.log'), 'one')
      await writeFile(join(album, 'CD2', 'rip.log'), 'two')
      await writeFile(join(root, '.gravlax-upload.json'), JSON.stringify({ sourcePath: album, stagedName: 'Album' }))
      await applyTagsAndRenames({
        workspacePath: album,
        release: { title: 'Album', tracks: [{ title: 'One', trackNumber: '1', discNumber: '1' }, { title: 'Two', trackNumber: '1', discNumber: '2' }] },
        plan: { folderName: 'Album', files: [
          { id: 'a', currentPath: 'CD1/a.flac', targetPath: 'Disc 01/01. One.flac', targetFilename: '01. One.flac', changed: true },
          { id: 'b', currentPath: 'CD2/b.flac', targetPath: 'Disc 02/01. Two.flac', targetFilename: '01. Two.flac', changed: true }
        ], payloadFiles: [
          { id: 'a', kind: 'file', currentPath: 'CD1/a.flac', targetPath: 'Disc 01/01. One.flac', targetName: '01. One.flac', changed: true, track: true },
          { id: 'b', kind: 'file', currentPath: 'CD2/b.flac', targetPath: 'Disc 02/01. Two.flac', targetName: '01. Two.flac', changed: true, track: true },
          { id: 'log-1', kind: 'file', currentPath: 'CD1/rip.log', targetPath: 'Disc 01/rip.log', targetName: 'rip.log', changed: true, track: false },
          { id: 'log-2', kind: 'file', currentPath: 'CD2/rip.log', targetPath: 'Disc 02/rip.log', targetName: 'rip.log', changed: true, track: false }
        ], folders: [], errors: [], warnings: [], hash: 'sidecars' },
        stripEmbeddedCoverArt: true
      })
      expect(await readFile(join(album, 'Disc 01', 'rip.log'), 'utf8')).toBe('one')
      expect(await readFile(join(album, 'Disc 02', 'rip.log'), 'utf8')).toBe('two')
      expect(await tagLines(join(album, 'Disc 01', '01. One.flac'), 'TRACKTOTAL')).toEqual([
        'TRACKTOTAL=1'
      ])
      expect(await tagLines(join(album, 'Disc 01', '01. One.flac'), 'DISCTOTAL')).toEqual([
        'DISCTOTAL=2'
      ])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})

async function tagLines(path: string, key: string): Promise<string[]> {
  return (await runCommand('metaflac', [`--show-tag=${key}`, path]))
    .toString('utf8')
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
}
