import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { writeSyntheticFlac } from '../../__tests__/helpers/audioFixture'
import { runCommand } from '../../runCommand'
import { extractAlbumReleaseWithEmbeddedCoverArt } from '../../../tags/extract'
import { applyTagsAndRenames, captureOriginalFiles, restoreOriginalFiles } from '../apply'

async function binaryAvailable(name: string): Promise<boolean> {
  for (const part of (process.env.PATH ?? '').split(delimiter)) {
    try { await access(join(part, name)); return true } catch { /* continue */ }
  }
  return false
}

describe('tag and filename writes', () => {
  it('writes through metaflac, strips pictures, renames, and restores the original', async () => {
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

      const captureProgress: Array<{ current: number; total: number; label: string }> = []
      const captured = await captureOriginalFiles(
        album,
        [{ id: 'track-1', currentPath: 'old.flac' }],
        undefined,
        undefined,
        (current, total, label) => captureProgress.push({ current, total, label })
      )
      expect(captured.pictureCount).toBe(1)
      expect(captureProgress.at(-1)).toEqual({
        current: 1,
        total: 1,
        label: 'Saved original tags: old.flac'
      })
      expect(captured.originals[0]?.managedComments?.join('\n')).not.toContain('LEGACYDATA')
      expect(captured.originals[0]?.legacyCoverBackups).toHaveLength(2)
      const applyProgress: Array<{ current: number; total: number; label: string }> = []
      const result = await applyTagsAndRenames({
        workspacePath: album,
        release: { title: 'New Album', groupYear: '2024', albumArtist: 'Artist', comment: 'Line one\nLine two', tracks: [{ title: 'New title', trackNumber: '1', discNumber: '1', artists: [{ name: 'Artist', role: 'main' }] }] },
        plan: { folderName: 'Artist - New Album', files: [{ id: 'track-1', currentPath: 'old.flac', targetPath: '01. New title.flac', targetFilename: '01. New title.flac', changed: true }], errors: [], warnings: [], hash: 'test' },
        originals: captured.originals,
        stripEmbeddedCoverArt: true,
        onProgress: (current, total, label) =>
          applyProgress.push({ current, total, label })
      })
      expect(applyProgress).toContainEqual({ current: 1, total: 2, label: 'Renaming files…' })
      expect(applyProgress.at(-1)).toEqual({ current: 2, total: 2, label: 'Finishing…' })
      const changed = join(result.workspacePath, '01. New title.flac')
      expect((await runCommand('metaflac', ['--show-tag=TITLE', changed])).toString()).toContain('TITLE=New title')
      expect((await runCommand('metaflac', ['--show-tag=ISRC', changed])).toString()).toContain('ISRC=KEEP')
      expect((await runCommand('metaflac', ['--show-tag=COMMENT', changed])).toString()).toContain('Line one\nLine two')
      expect((await runCommand('metaflac', ['--list', changed])).toString()).not.toContain('(PICTURE)')
      expect((await runCommand('metaflac', ['--show-tag=COVERART', changed])).toString()).toBe('')
      await runCommand('flac', ['-t', '--silent', changed])

      const restoredPath = await restoreOriginalFiles({
        workspacePath: result.workspacePath,
        originals: captured.originals,
        currentFiles: result.currentPaths,
        originalFolderName: 'Old Album'
      })
      const restored = join(restoredPath, 'old.flac')
      expect((await runCommand('metaflac', ['--show-tag=TITLE', restored])).toString()).toContain('TITLE=Old title')
      expect((await runCommand('metaflac', ['--list', restored])).toString()).toContain('(PICTURE)')
      expect((await runCommand('metaflac', ['--show-tag=COVERART', restored])).toString()).toContain('COVERART=LEGACYDATA')
      expect((await readFile(join(root, '.gravlax-upload.json'), 'utf8'))).toContain('Old Album')
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
        '--set-tag=COVERART=LEGACYDATA',
        '--set-tag=COVERARTMIME=image/png',
        `--import-picture-from=${image}`,
        source
      ])

      const current = [{ id: 'track-1', currentPath: 'track.flac' }]
      const captured = await captureOriginalFiles(album, current)
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
        originals: captured.originals,
        stripEmbeddedCoverArt: false
      })

      expect(await tagLines(source, 'COMPOSER')).toEqual([
        'COMPOSER=Adele',
        'COMPOSER=Bach, Johann Sebastian'
      ])
      expect(await tagLines(source, 'CONDUCTOR')).toEqual(['CONDUCTOR=Maestro'])
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
      expect(await tagLines(source, 'COVERART')).toEqual(['COVERART=LEGACYDATA'])
      expect((await runCommand('metaflac', ['--list', source])).toString()).toContain('(PICTURE)')

      const extracted = await extractAlbumReleaseWithEmbeddedCoverArt(source)
      expect(extracted.release.tracks?.[0]?.artists).toEqual([
        { name: 'Adele, Maestro', role: 'main' },
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
        originals: captured.originals,
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
        originals: captured.originals,
        stripEmbeddedCoverArt: false
      })
      expect(await tagLines(source, 'ARTIST')).toEqual(['ARTIST=Adele'])

      await restoreOriginalFiles({
        workspacePath: album,
        originals: captured.originals,
        currentFiles: current,
        originalFolderName: 'Album'
      })
      expect(await tagLines(source, 'COMPOSER')).toEqual([
        'COMPOSER=Adele',
        'COMPOSER=Bach, Johann Sebastian'
      ])
      expect(await tagLines(source, 'CONDUCTOR')).toEqual(['CONDUCTOR=Maestro'])
      expect(await tagLines(source, 'X-GRAVLAX-TEST')).toEqual(['X-GRAVLAX-TEST=keep me'])
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
      const current = [{ id: 'track-1', currentPath: longFilename }]
      const captured = await captureOriginalFiles(album, current)

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
        originals: captured.originals,
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

  it('moves disc sidecars with their tracks and restores them', async () => {
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
      const current = [{ id: 'a', currentPath: 'CD1/a.flac' }, { id: 'b', currentPath: 'CD2/b.flac' }]
      const captured = await captureOriginalFiles(album, current)
      const result = await applyTagsAndRenames({
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
        originals: captured.originals,
        stripEmbeddedCoverArt: true
      })
      expect(await readFile(join(album, 'Disc 01', 'rip.log'), 'utf8')).toBe('one')
      expect(await readFile(join(album, 'Disc 02', 'rip.log'), 'utf8')).toBe('two')
      await restoreOriginalFiles({
        workspacePath: result.workspacePath,
        originals: captured.originals,
        currentFiles: result.currentPaths,
        currentPayload: [
          { id: 'a', kind: 'file', currentPath: 'Disc 01/01. One.flac', originalPath: 'CD1/a.flac' },
          { id: 'b', kind: 'file', currentPath: 'Disc 02/01. Two.flac', originalPath: 'CD2/b.flac' },
          { id: 'log-1', kind: 'file', currentPath: 'Disc 01/rip.log', originalPath: 'CD1/rip.log' },
          { id: 'log-2', kind: 'file', currentPath: 'Disc 02/rip.log', originalPath: 'CD2/rip.log' }
        ],
        originalFolderName: 'Album'
      })
      expect(await readFile(join(album, 'CD1', 'rip.log'), 'utf8')).toBe('one')
      expect(await readFile(join(album, 'CD2', 'rip.log'), 'utf8')).toBe('two')
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
