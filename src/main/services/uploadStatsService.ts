import { basename } from 'node:path'
import type { UploadStats, UploadTrackerId } from '@shared/types'
import {
  loadUploadStats,
  publicUploadStats,
  saveUploadStats,
  type UploadStatsFile
} from '@main/core/appdata/uploadStats'
import { uploadWorkspaceRootForPath } from '@main/core/appdata/workspace'

export interface UploadStatsRecord {
  workspacePath: string
  formatId: string
  trackerId: UploadTrackerId
}

export class UploadStatsService {
  private stats: UploadStatsFile | null = null

  constructor(
    private readonly userDataPath: string,
    private readonly onChange: (stats: UploadStats) => void
  ) {}

  async get(): Promise<UploadStats> {
    await this.ensureLoaded()
    return publicUploadStats(this.stats!)
  }

  async record(record: UploadStatsRecord): Promise<UploadStats> {
    await this.ensureLoaded()
    const stats = this.stats!
    const workspaceId = basename(uploadWorkspaceRootForPath(record.workspacePath))
    if (!workspaceId || !record.formatId || !record.trackerId) return publicUploadStats(stats)

    const formatKey = JSON.stringify([workspaceId, record.formatId])
    const submissionKey = JSON.stringify([workspaceId, record.trackerId, record.formatId])
    const seenFormats = new Set(stats.seenFormats)
    const seenSubmissions = new Set(stats.seenSubmissions)
    let changed = false

    if (!seenFormats.has(formatKey)) {
      seenFormats.add(formatKey)
      stats.seenFormats = [...seenFormats]
      stats.formats[record.formatId] = (stats.formats[record.formatId] ?? 0) + 1
      changed = true
    }
    if (!seenSubmissions.has(submissionKey)) {
      seenSubmissions.add(submissionKey)
      stats.seenSubmissions = [...seenSubmissions]
      stats.trackers[record.trackerId] += 1
      changed = true
    }
    if (changed) {
      await saveUploadStats(this.userDataPath, stats)
      this.onChange(publicUploadStats(stats))
    }
    return publicUploadStats(stats)
  }

  private async ensureLoaded(): Promise<void> {
    if (this.stats) return
    this.stats = await loadUploadStats(this.userDataPath)
  }
}
