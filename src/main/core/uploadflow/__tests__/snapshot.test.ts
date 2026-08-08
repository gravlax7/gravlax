import { describe, expect, it } from 'vitest'
import { setFilesCheck } from '../filesCheck'
import { setSeed } from '../seed'
import { restoreState, snapshot } from '../snapshot'
import { beginSubmit, patchSubmission } from '../upload'
import {
  currentStep,
  newState,
  selectSourcePath,
  setCurrentStep,
  setSourceMedia,
  setDefaultSpectralIds,
  setSpectralIds,
  sourceMedia,
  spectralIds,
  spectralIdsAuto,
  stepIndex
} from '../state'

describe('snapshot round-trip', () => {
  it('keeps the saved step and media', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setSourceMedia(state, 'CD')
    state = setCurrentStep(state, stepIndex('tags')!)

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(currentStep(restored).id).toBe('tags')
    expect(sourceMedia(restored)).toBe('CD')
    expect(restored.draft.sourcePath).toBe('/music/album')
    expect(restored.draft.workspacePath).toBe('/workspace/upload-abc123')
  })

  it('restores an untouched source at step 0', () => {
    const state = selectSourcePath(newState(), '/music/album')
    const restored = restoreState('/workspace/upload-abc123', snapshot(state))
    expect(currentStep(restored).id).toBe('files-check')
  })

  it('migrates a legacy Source snapshot to Files Check', () => {
    const restored = restoreState('/workspace/upload-abc123', {
      sourcePath: '/music/album',
      currentStepID: 'source'
    })
    expect(currentStep(restored).id).toBe('files-check')
  })

  it('carries files-check results across a restart', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setSourceMedia(state, 'CD')
    state = setFilesCheck(state, {
      status: 'ok',
      mqa: { checkedCount: 2, mqaPaths: ['02.flac'], errors: [] },
      logs: {
        logFiles: ['rip.log'],
        checks: [
          {
            relativePath: 'rip.log',
            trackerId: 'redacted',
            trackerName: 'Redacted',
            score: 97,
            checksum: 'checksum_ok',
            issues: ['Test and copy was not used']
          }
        ]
      }
    })

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))
    expect(restored.filesCheck.status).toBe('ok')
    expect(restored.filesCheck.mqa.mqaPaths).toEqual(['02.flac'])
    expect(restored.filesCheck.logs.checks[0]?.score).toBe(97)
    expect(restored.filesCheck.logs.checks[0]?.issues).toEqual(['Test and copy was not used'])
  })

  it('restores an empty files-check from a snapshot written before it existed', () => {
    const state = selectSourcePath(newState(), '/music/album')
    const snap = snapshot(state)
    expect(snap.filesCheck).toBeUndefined()
    expect(restoreState('/workspace/upload-abc123', snap).filesCheck.status).toBe('idle')
  })

  it('migrates the retired rules-check step to upload', () => {
    const state = selectSourcePath(newState(), '/music/album')
    const snap = { ...snapshot(state), currentStepID: 'rules-check' as never }
    expect(currentStep(restoreState('/workspace/upload-abc123', snap)).id).toBe('upload')
  })

  it('round-trips submissions and flags an interrupted submit', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = beginSubmit(state, [
      {
        id: 'redacted:source',
        trackerId: 'redacted',
        formatId: 'source',
        label: 'Redacted · FLAC',
        status: 'pending'
      },
      {
        id: 'redacted:mp3',
        trackerId: 'redacted',
        formatId: 'mp3',
        label: 'Redacted · MP3',
        status: 'pending'
      }
    ])
    state = patchSubmission(state, 'redacted:source', {
      status: 'done',
      torrentId: 12,
      groupId: 3,
      url: 'https://red/torrents.php?torrentid=12',
      torrentPath: '/t/a.torrent'
    })
    state = patchSubmission(state, 'redacted:mp3', { status: 'running' })

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(restored.upload.phase).toBe('failed')
    expect(restored.upload.submissions?.[0]).toMatchObject({
      status: 'done',
      torrentId: 12,
      groupId: 3,
      torrentPath: '/t/a.torrent'
    })
    expect(restored.upload.submissions?.[1]?.status).toBe('failed')
  })

  it('keeps a hand-picked spectral selection, and keeps it hand-picked', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setSpectralIds(state, [3, 1])

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(spectralIds(restored)).toEqual([1, 3])
    expect(spectralIdsAuto(restored)).toBe(false)
  })

  it('keeps an empty hand-picked selection rather than re-defaulting it', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setSpectralIds(state, [])

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(spectralIds(restored)).toEqual([])
    expect(spectralIdsAuto(restored)).toBe(false)
  })

  it('keeps a pre-selection but leaves it open to the settings default', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setDefaultSpectralIds(state, [2])

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(spectralIds(restored)).toEqual([2])
    expect(spectralIdsAuto(restored)).toBe(true)
  })

  it('demotes a seed that was running when the app died', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setSeed(state, {
      phase: 'running',
      tasks: [
        { id: 'transfer:source', kind: 'transfer', label: 'Transfer', status: 'running' },
        { id: 'inject:source:redacted', kind: 'inject', label: 'Inject', status: 'pending' }
      ]
    })

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(restored.seed.phase).toBe('failed')
    expect(restored.seed.tasks[0]?.status).toBe('failed')
    expect(restored.seed.tasks[1]?.status).toBe('pending')
  })
})
