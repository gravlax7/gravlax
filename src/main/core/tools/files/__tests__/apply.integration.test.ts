import { access, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { writeSyntheticFlac } from '../../__tests__/helpers/audioFixture'
import { runCommand } from '../../runCommand'
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
        ], errors: [], warnings: [], hash: 'sidecars' },
        originals: captured.originals,
        stripEmbeddedCoverArt: true
      })
      expect(await readFile(join(album, 'Disc 01', 'rip.log'), 'utf8')).toBe('one')
      expect(await readFile(join(album, 'Disc 02', 'rip.log'), 'utf8')).toBe('two')
      await restoreOriginalFiles({ workspacePath: result.workspacePath, originals: captured.originals, currentFiles: result.currentPaths, originalFolderName: 'Album' })
      expect(await readFile(join(album, 'CD1', 'rip.log'), 'utf8')).toBe('one')
      expect(await readFile(join(album, 'CD2', 'rip.log'), 'utf8')).toBe('two')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})
