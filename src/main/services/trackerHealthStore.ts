import type { Config } from '@shared/types/config'
import type { HealthRow, UploadTrackerId } from '@shared/types'
import { trackerHealthRowId } from '@shared/upload/validation'

type Entry = { key: string; revision: number; rows: Map<string, HealthRow> }

/** Health belongs to the current credentials, not to a page or upload. */
class TrackerHealthStore {
  private entries = new Map<UploadTrackerId, Entry>()
  private listeners = new Set<() => void>()

  private key(cfg: Config, id: UploadTrackerId): string {
    const { enabled, siteUrl, apiKey, sessionCookie } = cfg.trackers[id]
    return JSON.stringify([enabled, siteUrl, apiKey, sessionCookie])
  }

  rows(cfg: Config, id: UploadTrackerId): HealthRow[] {
    const entry = this.entries.get(id)
    if (!entry || entry.key !== this.key(cfg, id)) return []
    return (['api', 'session'] as const)
      .map((mode) => entry.rows.get(trackerHealthRowId(id, mode)))
      .filter((row): row is HealthRow => Boolean(row))
  }

  ready(cfg: Config, id: UploadTrackerId): boolean {
    const rows = this.rows(cfg, id)
    return cfg.trackers[id].enabled && rows.length === 2 && rows.every((row) => row.status === 'available')
  }

  complete(cfg: Config, id: UploadTrackerId): boolean {
    const rows = this.rows(cfg, id)
    return rows.length === 2 && rows.every((row) => row.status !== 'checking')
  }

  begin(cfg: Config, id: UploadTrackerId): number {
    const revision = (this.entries.get(id)?.revision ?? 0) + 1
    this.entries.set(id, { key: this.key(cfg, id), revision, rows: new Map() })
    this.emit()
    return revision
  }

  record(cfg: Config, id: UploadTrackerId, revision: number, row: HealthRow): void {
    const entry = this.entries.get(id)
    if (!entry || entry.key !== this.key(cfg, id) || entry.revision !== revision) return
    entry.rows.set(row.id, { ...row })
    this.emit()
  }

  /** Used after a pre-submit check, including when a caller supplies its own probe. */
  recordResult(cfg: Config, id: UploadTrackerId, rows: readonly HealthRow[]): void {
    const revision = this.begin(cfg, id)
    for (const row of rows) this.record(cfg, id, revision, row)
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  reset(): void {
    this.entries.clear()
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const trackerHealthStore = new TrackerHealthStore()
