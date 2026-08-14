import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadSnapshot } from '@shared/types'
import { TorrentExportService } from '@main/services/torrentExportService'

let root = ''
let source = ''
let destination = ''

function upload(paths = [source]): UploadSnapshot {
  return {
    submissions: paths.map((torrentPath, index) => ({
      id: `redacted:format-${index}`,
      trackerId: 'redacted',
      formatId: `format-${index}`,
      label: `RED · Format ${index}`,
      status: 'done',
      torrentPath
    }))
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-torrent-export-'))
  source = join(root, 'album.torrent')
  destination = join(root, 'saved.torrent')
  await writeFile(source, 'torrent data')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('TorrentExportService', () => {
  it('saves one torrent selected by submission id', async () => {
    const pickSavePath = vi.fn(async () => destination)
    const service = new TorrentExportService({
      getUpload: () => upload(),
      pickSavePath,
      pickDirectory: async () => null
    })

    await expect(service.saveOne('redacted:format-0')).resolves.toEqual({
      ok: true,
      paths: [destination]
    })
    expect(pickSavePath).toHaveBeenCalledWith('album.torrent')
    await expect(readFile(destination, 'utf8')).resolves.toBe('torrent data')
  })

  it('reports a canceled save without copying', async () => {
    const service = new TorrentExportService({
      getUpload: () => upload(),
      pickSavePath: async () => null,
      pickDirectory: async () => null
    })

    await expect(service.saveOne('redacted:format-0')).resolves.toEqual({
      ok: false,
      canceled: true
    })
    await expect(service.saveAll()).resolves.toEqual({ ok: false, canceled: true })
  })

  it('rejects unknown and missing torrent files', async () => {
    const service = new TorrentExportService({
      getUpload: () => upload(),
      pickSavePath: async () => destination,
      pickDirectory: async () => null
    })

    await expect(service.saveOne('unknown')).resolves.toEqual({
      ok: false,
      error: 'That torrent file is not available.'
    })

    await rm(source)
    await expect(service.saveOne('redacted:format-0')).resolves.toEqual({
      ok: false,
      error: 'A torrent file or destination folder no longer exists.'
    })
  })

  it('saves all torrents into a chosen folder', async () => {
    const other = join(root, 'other.torrent')
    const exportDir = join(root, 'exports')
    await writeFile(other, 'other data')
    await mkdir(exportDir)
    const service = new TorrentExportService({
      getUpload: () => upload([source, other]),
      pickSavePath: async () => null,
      pickDirectory: async () => exportDir
    })

    const result = await service.saveAll()
    expect(result).toEqual({
      ok: true,
      paths: [join(exportDir, 'album.torrent'), join(exportDir, 'other.torrent')]
    })
    await expect(readFile(join(exportDir, 'other.torrent'), 'utf8')).resolves.toBe('other data')
  })

  it('does not overwrite an existing file during a bulk save', async () => {
    const exportDir = join(root, 'exports')
    await mkdir(exportDir)
    await writeFile(join(exportDir, 'album.torrent'), 'keep me')
    const service = new TorrentExportService({
      getUpload: () => upload(),
      pickSavePath: async () => null,
      pickDirectory: async () => exportDir
    })

    await expect(service.saveAll()).resolves.toEqual({
      ok: false,
      error: 'A file named "album.torrent" already exists in that folder.'
    })
    await expect(readFile(join(exportDir, 'album.torrent'), 'utf8')).resolves.toBe('keep me')
  })
})
