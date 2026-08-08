import { mkdtemp, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import {
  emptyUploadStats,
  loadUploadStats,
  saveUploadStats,
  uploadStatsPath
} from '@main/core/appdata/uploadStats'
import { UploadStatsService } from '@main/services/uploadStatsService'
import { totalUploads } from '@shared/types'

describe('upload statistics storage', () => {
  it('starts empty when no stats file exists', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'gravlax-upload-stats-'))

    await expect(loadUploadStats(userDataPath)).resolves.toEqual(emptyUploadStats())
  })

  it('treats malformed data as empty statistics', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'gravlax-upload-stats-'))
    await writeFile(uploadStatsPath(userDataPath), '{not valid json')

    await expect(loadUploadStats(userDataPath)).resolves.toEqual(emptyUploadStats())
  })

  it('persists aggregate counts and de-duplicates successful submissions', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'gravlax-upload-stats-'))
    const changed = vi.fn()
    const service = new UploadStatsService(userDataPath, changed)
    const sourceOnRed = {
      workspacePath: join(userDataPath, 'workspace', 'upload-random', 'Album'),
      formatId: 'source',
      trackerId: 'redacted' as const
    }

    await service.record(sourceOnRed)
    await service.record(sourceOnRed)
    await service.record({ ...sourceOnRed, trackerId: 'orpheus' })
    await service.record({ ...sourceOnRed, formatId: 'transcode-V0' })

    const stats = await service.get()
    expect(stats.formats).toEqual({ source: 1, 'transcode-V0': 1 })
    expect(stats.trackers).toEqual({ redacted: 2, orpheus: 1 })
    expect(totalUploads(stats)).toBe(2)
    expect(changed).toHaveBeenCalledTimes(3)

    const reloaded = new UploadStatsService(userDataPath, vi.fn())
    await expect(reloaded.get()).resolves.toEqual(stats)
  })

  it('writes a stats snapshot atomically', async () => {
    const userDataPath = await mkdtemp(join(tmpdir(), 'gravlax-upload-stats-'))
    const stats = emptyUploadStats()
    stats.formats.source = 4

    await saveUploadStats(userDataPath, stats)

    await expect(loadUploadStats(userDataPath)).resolves.toEqual(stats)
  })
})
