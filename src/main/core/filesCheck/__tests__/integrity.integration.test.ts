import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { writeSyntheticFlac } from '../../tools/__tests__/helpers/audioFixture'
import { runCommand } from '../../tools/runCommand'
import { checkFLACIntegrity, repairFLACIntegrity } from '../integrity'

async function binaryAvailable(name: string): Promise<boolean> {
  for (const part of (process.env.PATH ?? '').split(delimiter)) {
    try { await access(join(part, name)); return true } catch { /* continue */ }
  }
  return false
}

async function decodedHash(path: string): Promise<string> {
  const raw = await runCommand('flac', [
    '--decode',
    '--silent',
    '--stdout',
    '--force-raw-format',
    '--endian=little',
    '--sign=signed',
    path
  ])
  return createHash('sha256').update(raw).digest('hex')
}

describe('FLAC integrity repair with real tools', () => {
  it('repairs an unset MD5 without changing audio or metadata', async () => {
    if (!(await binaryAvailable('flac')) || !(await binaryAvailable('metaflac'))) return
    const root = await mkdtemp(join(tmpdir(), 'gravlax-integrity-real-'))
    try {
      const source = join(root, 'track.flac')
      const image = join(root, 'cover.png')
      await writeSyntheticFlac(source)
      await writeFile(image, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'))
      await runCommand('metaflac', [
        '--dont-use-padding',
        '--remove',
        '--block-type=PADDING',
        source
      ])
      await runCommand('metaflac', [
        '--set-tag=ISRC=KEEP',
        `--import-picture-from=${image}`,
        '--add-padding=4096',
        source
      ])
      const bytes = await readFile(source)
      bytes.fill(0, 26, 42)
      await writeFile(source, bytes)
      const sourceInfo = await stat(source)
      const audioBefore = await decodedHash(source)
      await expect(checkFLACIntegrity(source)).rejects.toThrow()

      await repairFLACIntegrity(source)

      await expect(checkFLACIntegrity(source)).resolves.toBeUndefined()
      const md5 = (await runCommand('metaflac', ['--show-md5sum', source])).toString().trim()
      expect(md5).toMatch(/^[0-9a-f]{32}$/)
      expect(md5).not.toBe('00000000000000000000000000000000')
      expect(await decodedHash(source)).toBe(audioBefore)
      expect((await runCommand('metaflac', ['--show-tag=ISRC', source])).toString()).toContain('ISRC=KEEP')
      const metadata = (await runCommand('metaflac', ['--list', source])).toString()
      expect(metadata).toContain('(PICTURE)')
      expect(metadata).toContain('length: 4096')
      const repairedInfo = await stat(source)
      expect(repairedInfo.mode).toBe(sourceInfo.mode)
      expect(Math.abs(repairedInfo.mtimeMs - sourceInfo.mtimeMs)).toBeLessThanOrEqual(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)

  it('leaves the source untouched and removes its temporary folder on failure', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gravlax-integrity-fail-'))
    try {
      const source = join(root, 'track.flac')
      await writeFile(source, 'original bytes')
      const run = vi.fn(async () => { throw new Error('encoder failed') })

      await expect(repairFLACIntegrity(source, { run })).rejects.toThrow('encoder failed')

      expect((await readFile(source)).toString()).toBe('original bytes')
      expect((await readdir(root)).filter((name) => name.startsWith('.gravlax-integrity-'))).toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
