import { afterEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import type { HealthRow, UploadSnapshot, UploadTrackerId } from '@shared/types'
import { trackerHealthStore } from '../trackerHealthStore'
import { reconcileUploadTrackerSelection } from '../uploadTrackerSelection'

afterEach(() => trackerHealthStore.reset())

function rows(id: UploadTrackerId, api: HealthRow['status'], session: HealthRow['status']): HealthRow[] {
  return [
    { id: `trackers:${id}:api`, name: `${id} API`, status: api, detail: api === 'failing' ? 'invalid key' : 'Available' },
    { id: `trackers:${id}:session`, name: `${id} Session`, status: session, detail: session === 'failing' ? 'expired session' : 'Available' }
  ]
}

describe('health-based destination selection', () => {
  it('removes only a failed destination and restores only that one after recovery', () => {
    const cfg = defaultConfig()
    cfg.trackers.redacted.enabled = true
    cfg.trackers.orpheus.enabled = true
    trackerHealthStore.recordResult(cfg, 'redacted', rows('redacted', 'failing', 'available'))
    trackerHealthStore.recordResult(cfg, 'orpheus', rows('orpheus', 'available', 'available'))
    const upload: UploadSnapshot = { phase: 'ready', selectedTrackerIds: ['redacted', 'orpheus'] }

    const afterFailure = reconcileUploadTrackerSelection(upload, cfg)
    expect(afterFailure.selectedTrackerIds).toEqual(['orpheus'])
    expect(afterFailure.healthDeselectedTrackerIds).toEqual(['redacted'])

    trackerHealthStore.recordResult(cfg, 'redacted', rows('redacted', 'available', 'available'))
    expect(reconcileUploadTrackerSelection(afterFailure, cfg).selectedTrackerIds).toEqual(['redacted', 'orpheus'])
    expect(reconcileUploadTrackerSelection({ phase: 'ready', selectedTrackerIds: ['orpheus'] }, cfg).selectedTrackerIds).toEqual(['orpheus'])
  })

  it('does not reuse a passing result after credentials change', () => {
    const cfg = defaultConfig()
    cfg.trackers.redacted.enabled = true
    trackerHealthStore.recordResult(cfg, 'redacted', rows('redacted', 'available', 'available'))
    expect(trackerHealthStore.ready(cfg, 'redacted')).toBe(true)
    cfg.trackers.redacted.apiKey = 'new key'
    expect(trackerHealthStore.ready(cfg, 'redacted')).toBe(false)
    expect(trackerHealthStore.rows(cfg, 'redacted')).toEqual([])
  })

  it('ignores an older check that finishes after a newer one', () => {
    const cfg = defaultConfig()
    cfg.trackers.redacted.enabled = true
    const old = trackerHealthStore.begin(cfg, 'redacted')
    const current = trackerHealthStore.begin(cfg, 'redacted')
    for (const row of rows('redacted', 'available', 'available')) {
      trackerHealthStore.record(cfg, 'redacted', current, row)
    }
    trackerHealthStore.record(cfg, 'redacted', old, rows('redacted', 'failing', 'failing')[0]!)
    expect(trackerHealthStore.ready(cfg, 'redacted')).toBe(true)
  })

  it('clears restoration when a tracker is disabled and leaves finished uploads alone', () => {
    const cfg = defaultConfig()
    cfg.trackers.redacted.enabled = false
    const upload: UploadSnapshot = { phase: 'ready', selectedTrackerIds: [], healthDeselectedTrackerIds: ['redacted'] }
    expect(reconcileUploadTrackerSelection(upload, cfg).healthDeselectedTrackerIds).toEqual([])
    expect(reconcileUploadTrackerSelection({ ...upload, phase: 'done' }, cfg)).toBeDefined()
    expect(reconcileUploadTrackerSelection({ ...upload, phase: 'done' }, cfg).healthDeselectedTrackerIds).toEqual(['redacted'])
  })

  it('deselects a tracker when it is disabled', () => {
    const cfg = defaultConfig()
    cfg.trackers.redacted.enabled = false
    cfg.trackers.orpheus.enabled = true
    const upload: UploadSnapshot = { phase: 'ready', selectedTrackerIds: ['redacted', 'orpheus'] }

    const deselected = reconcileUploadTrackerSelection(upload, cfg)
    expect(deselected.selectedTrackerIds).toEqual(['orpheus'])

    cfg.trackers.redacted.enabled = true
    trackerHealthStore.recordResult(cfg, 'redacted', rows('redacted', 'available', 'available'))
    expect(reconcileUploadTrackerSelection(deselected, cfg).selectedTrackerIds).toEqual(['orpheus'])
  })
})
