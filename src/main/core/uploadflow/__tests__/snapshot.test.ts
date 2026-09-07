import { describe, expect, it } from 'vitest'
import { setFileChecks } from '../fileChecks'
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
    expect(currentStep(restored).id).toBe('file-checks')
  })

  it('preselects manual metadata when restoring the metadata step', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setCurrentStep(state, stepIndex('metadata')!)

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(restored.metadata.selected).toEqual({ provider: 'manual' })
  })

  it('preselects existing tags and its safe file choices when configured', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setCurrentStep(state, stepIndex('metadata')!)

    const restored = restoreState('/workspace/upload-abc123', snapshot(state), true)

    expect(restored.metadata.selected).toEqual({ provider: 'keep-existing-tags' })
    expect(restored.files.apply).toMatchObject({
      renameReleaseFolder: false,
      renameTrackFiles: false,
      stripEmbeddedCoverArt: false
    })
  })

  it('does not replace a saved metadata choice with the configured default', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setCurrentStep(state, stepIndex('metadata')!)
    state.metadata.selected = { provider: 'manual' }

    const restored = restoreState('/workspace/upload-abc123', snapshot(state), true)

    expect(restored.metadata.selected).toEqual({ provider: 'manual' })
  })

  it('restores a saved existing-tag choice and its per-upload file choices', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setCurrentStep(state, stepIndex('metadata')!)
    state.metadata.selected = { provider: 'keep-existing-tags' }
    state.files.apply.renameReleaseFolder = false
    state.files.apply.renameTrackFiles = true
    state.files.apply.stripEmbeddedCoverArt = false

    const restored = restoreState('/workspace/upload-abc123', snapshot(state), false)

    expect(restored.metadata.selected).toEqual({ provider: 'keep-existing-tags' })
    expect(restored.files.apply).toMatchObject({
      renameReleaseFolder: false,
      renameTrackFiles: true,
      stripEmbeddedCoverArt: false
    })
  })

  it('treats a missing track-rename choice in an old snapshot as on', () => {
    const state = selectSourcePath(newState(), '/music/album')
    const saved = snapshot(state)
    delete (saved.files!.apply as { renameTrackFiles?: boolean }).renameTrackFiles

    const restored = restoreState('/workspace/upload-abc123', saved)

    expect(restored.files.apply.renameTrackFiles).toBe(true)
  })

  it('drops old tag backups when restoring a saved workspace', () => {
    const saved = snapshot(selectSourcePath(newState(), '/music/album'))
    Object.assign(saved.files!.original, {
      folderName: 'album',
      files: [{ id: 'track-1', relativePath: 'track.flac', managedComments: ['TITLE=Old'] }],
      captured: true,
      coverCaptured: true,
      embeddedCoverArtCount: 2,
      restoreAvailable: false,
      restoreUnavailableReason: 'changed'
    })

    const restored = restoreState('/workspace/upload-abc123', saved)

    expect(snapshot(restored).files!.original).toEqual({
      embeddedCoverArtCount: 2,
      restoreAvailable: false,
      restoreUnavailableReason: 'changed'
    })
  })

  it('migrates a legacy Source snapshot to File Checks', () => {
    const restored = restoreState('/workspace/upload-abc123', {
      sourcePath: '/music/album',
      currentStepID: 'source'
    })
    expect(currentStep(restored).id).toBe('file-checks')
  })

  it('carries file-checks results across a restart', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setSourceMedia(state, 'CD')
    state = setFileChecks(state, {
      status: 'ok',
      structure: { ready: true, issues: [], approvedPaths: [], emptyDirectories: [], quarantined: [] },
      integrity: { status: 'passed', checkedCount: 2, failures: [], repairedPaths: [], repairErrors: [] },
      mqa: { checkedCount: 2, mqaPaths: ['02.flac'], errors: [] },
      upconvert: {
        checkedCount: 1,
        results: [
          {
            relativePath: '02.flac',
            bitDepth: 24,
            wastedBits: 8,
            isUpconverted: true
          }
        ],
        errors: []
      },
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
    expect(restored.fileChecks.status).toBe('ok')
    expect(restored.fileChecks.mqa.mqaPaths).toEqual(['02.flac'])
    expect(restored.fileChecks.upconvert.results[0]).toMatchObject({
      relativePath: '02.flac',
      wastedBits: 8,
      isUpconverted: true
    })
    expect(restored.fileChecks.logs.checks[0]?.score).toBe(97)
    expect(restored.fileChecks.logs.checks[0]?.issues).toEqual(['Test and copy was not used'])
  })

  it('restores an empty file-checks from a snapshot written before it existed', () => {
    const state = selectSourcePath(newState(), '/music/album')
    const snap = snapshot(state)
    expect(snap.fileChecks).toBeUndefined()
    expect(restoreState('/workspace/upload-abc123', snap).fileChecks.status).toBe('idle')
  })

  it('fills in upconvert results for a file-checks snapshot written before the check existed', () => {
    const state = setSourceMedia(selectSourcePath(newState(), '/music/album'), 'WEB')
    const snap = snapshot(state)
    snap.fileChecks = {
      status: 'ok',
      mqa: { checkedCount: 1, mqaPaths: [], errors: [] },
      logs: { logFiles: [], checks: [] }
    } as never

    expect(restoreState('/workspace/upload-abc123', snap).fileChecks.upconvert).toEqual({
      checkedCount: 0,
      results: [],
      errors: []
    })
    const restored = restoreState('/workspace/upload-abc123', snap)
    expect(restored.fileChecks.integrity.status).toBe('idle')
    expect(restored.background.tasks.find((task) => task.id === 'file-checks')?.status).toBe('queued')
  })

  it('migrates the retired rules-check step to upload', () => {
    const state = selectSourcePath(newState(), '/music/album')
    const snap = { ...snapshot(state), currentStepID: 'rules-check' as never }
    expect(currentStep(restoreState('/workspace/upload-abc123', snap)).id).toBe('upload')
  })

  it.each(['transcode', 'upload'] as const)(
    'returns an editable %s snapshot with unresolved separator artists to tags',
    (step) => {
      let state = selectSourcePath(newState(), '/music/album')
      state = setCurrentStep(state, stepIndex(step)!)
      state.tags.proposed = {
        title: 'Album',
        artists: [{ name: 'New & Unresolved', role: 'main' }]
      }

      const restored = restoreState('/workspace/upload-abc123', snapshot(state))

      expect(currentStep(restored).id).toBe('tags')
    }
  )

  it('keeps a resolved separator choice at the saved step', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setCurrentStep(state, stepIndex('transcode')!)
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'AC/DC', role: 'main', separatorKept: true }]
    }

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(currentStep(restored).id).toBe('transcode')
  })

  it('does not return an upload with a successful submission to tags', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setCurrentStep(state, stepIndex('upload')!)
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'New & Unresolved', role: 'main' }]
    }
    state = beginSubmit(state, [
      {
        id: 'redacted:source',
        trackerId: 'redacted',
        formatId: 'source',
        label: 'Redacted · FLAC',
        status: 'pending'
      }
    ])
    state = patchSubmission(state, 'redacted:source', { status: 'done' })

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(currentStep(restored).id).toBe('upload')
  })

  it('does not return an interrupted upload to tags', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setCurrentStep(state, stepIndex('upload')!)
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'New & Unresolved', role: 'main' }]
    }
    state = beginSubmit(state, [
      {
        id: 'redacted:source',
        trackerId: 'redacted',
        formatId: 'source',
        label: 'Redacted · FLAC',
        status: 'pending'
      }
    ])

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(restored.upload.phase).toBe('failed')
    expect(currentStep(restored).id).toBe('upload')
  })

  it('does not return a completed upload to tags', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setCurrentStep(state, stepIndex('upload')!)
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'New & Unresolved', role: 'main' }]
    }
    state.upload.phase = 'done'

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(currentStep(restored).id).toBe('upload')
  })

  it('does not return a seeding task to tags', () => {
    let state = selectSourcePath(newState(), '/music/album')
    state = setCurrentStep(state, stepIndex('seed')!)
    state.tags.proposed = {
      title: 'Album',
      artists: [{ name: 'New & Unresolved', role: 'main' }]
    }
    state = setSeed(state, {
      phase: 'running',
      tasks: [{ id: 'copy:source', kind: 'copy', label: 'Copy', status: 'running' }]
    })

    const restored = restoreState('/workspace/upload-abc123', snapshot(state))

    expect(currentStep(restored).id).toBe('seed')
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
