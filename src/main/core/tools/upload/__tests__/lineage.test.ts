import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  lineageText,
  listLineageCandidates,
  pickLineageFile,
  readLineageText
} from '../lineage'

const fixture = (name: string): Promise<Buffer> => readFile(join(__dirname, 'fixtures', name))

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gravlax-lineage-'))
  dirs.push(dir)
  return dir
}

describe('readLineageText', () => {
  it('turns mixed CRLF and LF into LF and trims the end', async () => {
    const text = readLineageText(await fixture('lineage-single.txt'))
    expect(text).not.toContain('\r')
    expect(text.startsWith('ANSWER TO THE DEFINITIVE RETURNS LINEAGE\n\nVPI Scoutmaster')).toBe(true)
    expect(text.endsWith('Double-Conversion UPS')).toBe(true)
  })

  it('strips a UTF-8 BOM', async () => {
    const text = readLineageText(await fixture('lineage-utf8-bom.txt'))
    expect(text.startsWith('ANSWER TO THE MASTER LINEAGE\n')).toBe(true)
  })

  it('reads UTF-16 with a BOM', async () => {
    const text = readLineageText(await fixture('lineage-utf16.txt'))
    expect(text.charCodeAt(0)).not.toBe(0xfeff)
    expect(text).toContain('J.B. Lenoir ‎– Alabama Blues')
    expect(text).toContain('- ADC : Tascam US-144; Goldkabel\n')
    expect(text).not.toContain('\r')
  })

  it('reads big-endian UTF-16', () => {
    const le = Buffer.from('Turntable\r\nCartridge\r\n', 'utf16le')
    const be = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(le).swap16()])
    expect(readLineageText(be)).toBe('Turntable\nCartridge')
  })
})

describe('lineage files', () => {
  it('lists root text files only', async () => {
    const dir = await tempDir()
    await mkdir(join(dir, 'Side A'))
    await writeFile(join(dir, 'Side A', 'notes.txt'), '')
    await writeFile(join(dir, 'lineage.txt'), '')
    await writeFile(join(dir, 'info.NFO'), '')
    await writeFile(join(dir, 'rip.log'), '')
    await writeFile(join(dir, '01.flac'), '')
    expect(await listLineageCandidates(dir)).toEqual(['info.NFO', 'lineage.txt', 'rip.log'])
  })

  it('picks the one file named as lineage', () => {
    expect(pickLineageFile(['info.nfo', 'Lineage.TXT'])).toBe('Lineage.TXT')
    expect(pickLineageFile(['info.nfo'])).toBeNull()
    expect(pickLineageFile(['lineage-a.txt', 'lineage-b.txt'])).toBeNull()
  })

  it('reads the text of each kind', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'lineage.txt'), 'Turntable\r\n\r\n')
    expect(await lineageText(dir, { kind: 'file', path: 'lineage.txt' })).toBe('Turntable')
    expect(await lineageText(dir, { kind: 'pasted', text: 'Cartridge\r\n' })).toBe('Cartridge')
    expect(await lineageText(dir, { kind: 'none' })).toBeUndefined()
    expect(await lineageText(dir, undefined)).toBeUndefined()
  })
})
