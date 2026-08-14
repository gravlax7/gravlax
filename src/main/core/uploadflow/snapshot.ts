import type { UploadFlowSnapshot } from '@shared/types'
import { withTaskSnapshotStatuses } from './background'
import { setFilesCheck } from './filesCheck'
import { setFiles } from './files'
import { setMetadata } from './metadata'
import {
  newState,
  selectSourcePath,
  setCurrentStep,
  setLossyComment,
  setLossyMaster,
  setSourceMedia,
  setSpectralIds,
  setDefaultSpectralIds,
  setWorkspacePath,
  stepIndex,
  type State,
  currentStep as getCurrentStep,
  sourcePath as getSourcePath,
  sourceMedia as getSourceMedia,
  lossyComment as getLossyComment,
  lossyMaster as getLossyMaster,
  spectralIds as getSpectralIds,
  spectralIdsAuto as getSpectralIdsAuto
} from './state'
import { setTags } from './tags'
import { setTranscode } from './transcode'
import { resumeGroupSearch, resumeSubmit, setUpload } from './upload'
import { resumeSeed, setSeed } from './seed'

export function snapshot(s: State): UploadFlowSnapshot {
  const result: UploadFlowSnapshot = {
    sourcePath: getSourcePath(s),
    currentStepID: getCurrentStep(s).id,
    sourceMedia: getSourceMedia(s) || undefined,
    lossyMaster: getLossyMaster(s) || undefined,
    lossyComment: getLossyComment(s) || undefined,
    // Kept even when auto, so a `Random` pre-selection survives a restart
    // instead of landing on a different track.
    spectralIds: getSpectralIds(s).length > 0 ? getSpectralIds(s) : undefined,
    spectralIdsAuto: getSpectralIdsAuto(s) ? undefined : false
  }

  if (s.background.tasks.length > 0) {
    result.tasks = {}
    for (const task of s.background.tasks) {
      result.tasks[task.id] = {
        status: task.status,
        detail: task.detail || undefined,
        progressCurrent: task.progressCurrent || undefined,
        progressTotal: task.progressTotal || undefined,
        progressLabel: task.progressLabel || undefined
      }
    }
  }

  result.metadata = s.metadata
  result.tags = s.tags
  result.files = s.files
  result.transcode = s.transcode
  if (s.filesCheck.status !== 'idle') {
    result.filesCheck = s.filesCheck
  }
  if (s.upload.phase && s.upload.phase !== 'idle') {
    result.upload = s.upload
  }
  if (s.seed.phase && s.seed.phase !== 'idle') {
    result.seed = s.seed
  }
  return result
}

export function restoreState(workspacePath: string, snap: UploadFlowSnapshot): State {
  if (!snap.sourcePath) {
    throw new Error('missing source path')
  }

  let state = setWorkspacePath(selectSourcePath(newState(), snap.sourcePath), workspacePath)
  if (snap.sourceMedia) {
    state = setSourceMedia(state, snap.sourceMedia)
  }
  if (snap.lossyMaster) {
    state = setLossyMaster(state, true)
  }
  if (snap.lossyComment) {
    state = setLossyComment(state, snap.lossyComment)
  }
  if (snap.spectralIdsAuto === false) {
    state = setSpectralIds(state, snap.spectralIds ?? [])
  } else if (snap.spectralIds) {
    state = setDefaultSpectralIds(state, snap.spectralIds)
  }

  const migratedStepID =
    (snap.currentStepID as string) === 'rules-check'
      ? 'upload'
      : snap.currentStepID === 'source'
        ? 'files-check'
        : snap.currentStepID
  const index = stepIndex(migratedStepID)
  if (index === null) {
    throw new Error(`unknown step "${snap.currentStepID}"`)
  }
  state = setCurrentStep(state, index)

  if (snap.tasks && Object.keys(snap.tasks).length > 0) {
    state = {
      ...state,
      background: withTaskSnapshotStatuses(state.background, snap.tasks)
    }
  }
  state = setMetadata(state, snap.metadata ?? {})
  state = setTags(state, snap.tags ?? {})
  if (snap.files) state = setFiles(state, snap.files)
  state = setTranscode(state, snap.transcode ?? {})
  if (snap.filesCheck) {
    state = setFilesCheck(state, snap.filesCheck)
  }
  if (snap.upload) {
    state = resumeSubmit(resumeGroupSearch(setUpload(state, snap.upload)))
  }
  if (snap.seed) {
    state = resumeSeed(setSeed(state, snap.seed))
  }

  // A restored session has no work in flight: anything still running would
  // show a frozen progress bar and hide the retry affordance behind a phase
  // that never resolves.
  const running = [
    ...state.background.tasks.filter((task) => task.status === 'running'),
    ...state.seed.tasks.filter((task) => task.status === 'running'),
    ...(state.upload.submissions ?? []).filter((submission) => submission.status === 'running')
  ]
  if (running.length > 0) {
    throw new Error(`restoreState: ${running.length} task(s) left running after restore`)
  }
  return state
}
