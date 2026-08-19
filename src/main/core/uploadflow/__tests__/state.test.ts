import { describe, expect, it } from 'vitest'
import {
  backgroundWork,
  markBackgroundTaskCompleted,
  emptyFilesCheck,
  setFilesCheck,
  lossyComment,
  lossyMaster,
  newState,
  selectSourcePath,
  setCurrentStep,
  setLossyComment,
  setLossyMaster,
  setSourceMedia,
  setDefaultSpectralIds,
  setSpectralIds,
  spectralIds,
  spectralIdsAuto,
  setWorkspacePath,
  sourceMedia,
  sourcePath,
  steps,
  workspacePath,
  currentStepIndex,
  started,
  taskCount,
  queuedCount,
  nextQueuedTask,
  snapshot,
  restoreState,
  setTagsRelease,
  setTagsProposed,
  clearTagsRelease,
  resetTagsProposed,
  setMetadataSelection,
  tags,
  seedTagsProposed
} from '@main/core/uploadflow'
import type { Release } from '@shared/types'

describe('uploadflow', () => {
  it('steps use expected order', () => {
    const got = steps().map((s) => s.id)
    expect(got).toEqual([
      'files-check',
      'spectrals',
      'metadata',
      'tags',
      'transcode',
      'upload',
      'seed'
    ])
  })

  it('selectSourcePath clears draft for different folder', () => {
    let state = setCurrentStep(
      setSourceMedia(
        setLossyMaster(setWorkspacePath(selectSourcePath(setCurrentStep(newState(), 2), '/tmp/release'), '/tmp/workspace/release'), true),
        'CD'
      ),
      0
    )
    state = selectSourcePath(state, '/tmp/other-release')
    expect(currentStepIndex(state)).toBe(0)
    expect(sourcePath(state)).toBe('/tmp/other-release')
    expect(sourceMedia(state)).toBe('')
    expect(lossyMaster(state)).toBe(false)
    expect(workspacePath(state)).toBe('')
    const background = backgroundWork(state)
    expect(started(background)).toBe(true)
    expect(taskCount(background)).toBe(3)
  })

  it('selectSourcePath drops the previous release results', () => {
    let state = setFilesCheck(selectSourcePath(newState(), '/tmp/release'), {
      status: 'ok',
      mqa: { checkedCount: 2, mqaPaths: ['02.flac'], errors: [] },
      logs: { logFiles: ['rip.log'], checks: [] }
    })
    state = selectSourcePath(state, '/tmp/other-release')
    expect(state.filesCheck).toEqual(emptyFilesCheck())
  })

  it('selectSourcePath queues the media-independent work and leaves media unset', () => {
    const state = selectSourcePath(newState(), '/tmp/release')
    expect(sourceMedia(state)).toBe('')
    expect(backgroundWork(state).tasks.map((t) => t.id)).toEqual([
      'spectrals',
      'metadata',
      'transcode'
    ])
    expect(queuedCount(backgroundWork(state))).toBe(3)
  })

  it('selectSourcePath keeps draft for same folder', () => {
    let state = setCurrentStep(
      setSourceMedia(
        setWorkspacePath(selectSourcePath(newState(), '/tmp/release'), '/tmp/workspace/release'),
        'CD'
      ),
      0
    )
    state = selectSourcePath(state, '/tmp/release')
    expect(sourcePath(state)).toBe('/tmp/release')
    expect(sourceMedia(state)).toBe('CD')
    expect(workspacePath(state)).toBe('/tmp/workspace/release')
    state = setLossyMaster(state, true)
    state = selectSourcePath(state, '/tmp/release')
    expect(lossyMaster(state)).toBe(true)
    expect(currentStepIndex(state)).toBe(0)
  })

  it('setSourceMedia stays on the current step', () => {
    let state = setCurrentStep(selectSourcePath(newState(), '/tmp/release'), 1)
    state = setSourceMedia(state, 'CD')
    expect(sourceMedia(state)).toBe('CD')
    expect(currentStepIndex(state)).toBe(1)
  })

  it('setSourceMedia adds files check and nothing else', () => {
    let state = selectSourcePath(newState(), '/tmp/release')
    expect(started(backgroundWork(state))).toBe(true)
    expect(taskCount(backgroundWork(state))).toBe(3)

    state = setSourceMedia(state, 'CD')
    const background = backgroundWork(state)
    expect(sourceMedia(state)).toBe('CD')
    expect(background.tasks.map((t) => t.id)).toEqual([
      'spectrals',
      'metadata',
      'transcode',
      'files-check'
    ])
    expect(queuedCount(background)).toBe(4)
  })

  it('changing media re-queues only files check', () => {
    let state = setSourceMedia(selectSourcePath(newState(), '/tmp/release'), 'WEB')
    state = markBackgroundTaskCompleted(state, 'metadata', 'done')
    state = markBackgroundTaskCompleted(state, 'files-check', 'done')

    state = setSourceMedia(state, 'CD')
    const byID = (id: string) => backgroundWork(state).tasks.find((t) => t.id === id)
    expect(byID('files-check')?.status).toBe('queued')
    expect(byID('files-check')?.detail).toBe('')
    expect(byID('metadata')?.status).toBe('succeeded')
  })

  it('setSourceMedia is no-op without source path', () => {
    const state = setSourceMedia(newState(), 'CD')
    expect(sourceMedia(state)).toBe('')
    expect(currentStepIndex(state)).toBe(0)
  })

  it('setLossyComment persists through snapshot restore and survives lossy toggle', () => {
    let state = setLossyMaster(selectSourcePath(newState(), '/tmp/release'), true)
    state = setLossyComment(state, 'Soft clipped')
    expect(lossyComment(state)).toBe('Soft clipped')
    state = setLossyMaster(state, false)
    expect(lossyComment(state)).toBe('Soft clipped')
    state = setLossyMaster(state, true)
    expect(lossyComment(state)).toBe('Soft clipped')
    const snap = snapshot(state)
    expect(snap.lossyMaster).toBe(true)
    expect(snap.lossyComment).toBe('Soft clipped')
    const restored = restoreState('/tmp/workspace/release', snap)
    expect(lossyMaster(restored)).toBe(true)
    expect(lossyComment(restored)).toBe('Soft clipped')
  })

  it('setDefaultSpectralIds pre-selects until the user picks for themselves', () => {
    let state = selectSourcePath(newState(), '/tmp/release')
    expect(spectralIds(state)).toEqual([])
    expect(spectralIdsAuto(state)).toBe(true)

    state = setDefaultSpectralIds(state, [2])
    expect(spectralIds(state)).toEqual([2])

    // The lossy default replaces a pre-selection...
    state = setDefaultSpectralIds(state, [1, 2, 3])
    expect(spectralIds(state)).toEqual([1, 2, 3])

    // ...but never a hand-picked one.
    state = setSpectralIds(state, [3, 1, 1])
    expect(spectralIds(state)).toEqual([1, 3])
    expect(spectralIdsAuto(state)).toBe(false)
    state = setDefaultSpectralIds(state, [1, 2, 3])
    expect(spectralIds(state)).toEqual([1, 3])
  })

  it('a new source folder drops the previous spectral selection', () => {
    let state = setSpectralIds(selectSourcePath(newState(), '/tmp/release'), [1, 2])
    state = selectSourcePath(state, '/tmp/other-release')
    expect(spectralIds(state)).toEqual([])
    expect(spectralIdsAuto(state)).toBe(true)
  })

  it('snapshot restore demotes running tasks and loading tags', () => {
    let state = setSourceMedia(selectSourcePath(newState(), '/tmp/release'), 'WEB')
    state = {
      ...state,
      background: {
        ...state.background,
        tasks: state.background.tasks.map((t) =>
          t.id === 'spectrals' ? { ...t, status: 'running', detail: 'busy', progressCurrent: 1, progressTotal: 2 } : t
        )
      },
      tags: { currentStatus: 'loading', releaseStatus: 'loading', currentError: 'x', releaseError: 'y' }
    }
    const snap = snapshot(state)
    const restored = restoreState('/tmp/workspace/release', snap)
    const spectral = restored.background.tasks.find((t) => t.id === 'spectrals')
    expect(spectral?.status).toBe('queued')
    expect(spectral?.detail).toBe('')
    expect(spectral?.progressCurrent).toBe(0)
    expect(restored.tags.currentStatus).toBe('idle')
    expect(restored.tags.releaseStatus).toBe('idle')
  })

  it('seedTagsProposed falls back to local non-mixed values', () => {
    const current: Release = {
      title: 'Local Title',
      albumArtist: 'Local AA',
      artists: [{ name: 'Local', role: 'main' }],
      trackCount: 5,
      tracks: [{ trackNumber: '1', title: 'Local Track', artists: [{ name: 'Local', role: 'main' }] }]
    }
    const selected: Release = { title: '', trackCount: 0 }
    const proposed = seedTagsProposed(current, selected)
    expect(proposed.title).toBe('Local Title')
    expect(proposed.albumArtist).toBe('Local AA')
    expect(proposed.trackCount).toBe(5)
    expect(proposed.tracks).toEqual(current.tracks)
  })

  it('seedTagsProposed copies mixed local genres when metadata has none', () => {
    const current: Release = {
      genres: ['Electronic', 'Ambient'],
      mixed: { genres: true }
    }
    const proposed = seedTagsProposed(current, {})
    expect(proposed.genres).toEqual(['Electronic', 'Ambient'])
  })

  it('seedTagsProposed merges empty track fields from current', () => {
    const current: Release = {
      tracks: [
        {
          discNumber: '1',
          trackNumber: '1',
          title: 'Local',
          artists: [{ name: 'Local', role: 'main' }]
        }
      ]
    }
    const selected: Release = {
      tracks: [{ trackNumber: '1', title: 'Remote' }]
    }
    const proposed = seedTagsProposed(current, selected)
    expect(proposed.tracks?.[0]).toEqual({
      discNumber: '1',
      trackNumber: '1',
      title: 'Remote',
      artists: [{ name: 'Local', role: 'main' }]
    })
  })

  it('setTagsRelease seeds proposed from selected and current', () => {
    let state = selectSourcePath(newState(), '/tmp/release')
    state = {
      ...state,
      tags: {
        current: { title: 'Local', trackCount: 3 },
        currentStatus: 'ready'
      }
    }
    state = setTagsRelease(state, { title: 'Remote', artists: [{ name: 'A', role: 'main' }] })
    expect(tags(state).proposed?.title).toBe('Remote')
    expect(tags(state).proposed?.trackCount).toBe(3)
    expect(tags(state).proposed?.albumArtist).toBe('A')
    expect(tags(state).proposedDirty).toBe(false)
  })

  it('setTagsProposed marks proposed dirty and release reset clears it', () => {
    let state = setTagsRelease(newState(), { title: 'Remote' })
    expect(tags(state).proposedDirty).toBe(false)
    state = setTagsProposed(state, { title: 'Edited' })
    expect(tags(state).proposedDirty).toBe(true)
    expect(tags(state).proposed?.title).toBe('Edited')
    state = clearTagsRelease(state)
    expect(tags(state).proposedDirty).toBe(false)
  })

  it('resetTagsProposed restores seeded proposed from selected', () => {
    let state = setMetadataSelection(newState(), { provider: 'musicbrainz', releaseId: '1' })
    state = {
      ...state,
      tags: {
        current: { title: 'Local', trackCount: 2 },
        currentStatus: 'ready',
        selected: { title: 'Remote', artists: [{ name: 'A', role: 'main' }] },
        proposed: { title: 'Edited' },
        proposedDirty: true,
        releaseStatus: 'ready'
      }
    }
    state = resetTagsProposed(state)
    expect(tags(state).proposed?.title).toBe('Remote')
    expect(tags(state).proposed?.trackCount).toBe(2)
    expect(tags(state).proposedDirty).toBe(false)
  })
})
