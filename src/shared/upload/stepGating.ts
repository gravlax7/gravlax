import type {
  BackgroundTask,
  StepID,
  TranscodeSnapshot,
  UploadFlowStateJSON
} from '../types/upload'
import { pendingSeparatorArtists } from '../tags/editor'
import { lossyMasterMissingSpectral } from './lossyReport'
import { upconvertsFound } from './fileChecks/upconvert'
import {
  WORKFLOW_STEPS,
  evaluateStepNavigation,
  highestReachableStep,
  workflowStepIndex
} from './workflow'

export type StepNodeStatus = 'done' | 'current' | 'upcoming' | 'error'

export const UPLOAD_STEPS = WORKFLOW_STEPS.map((step, index) => ({ ...step, index }))

export function stepIndexOf(id: StepID): number {
  return workflowStepIndex(id) ?? 0
}

export function canNavigateToStep(targetIndex: number, state: UploadFlowStateJSON): boolean {
  return evaluateStepNavigation(state, targetIndex).ok
}

export function stepNodeStatus(
  index: number,
  state: UploadFlowStateJSON
): StepNodeStatus {
  if (index === state.currentStep) return 'current'
  if (stepHasError(index, state)) return 'error'
  if (index < state.currentStep) return 'done'
  return 'upcoming'
}

export function stepHasError(index: number, state: UploadFlowStateJSON): boolean {
  switch (WORKFLOW_STEPS[index]?.id) {
    case 'file-checks':
      return !state.fileChecks.structure.ready ||
        state.fileChecks.integrity.status === 'failed' ||
        upconvertsFound(state.fileChecks) ||
        taskById(state.background.tasks, 'file-checks')?.status === 'failed'
    case 'spectrals': {
      const spectrals = taskById(state.background.tasks, 'spectrals')
      return spectrals?.status === 'failed' ||
        (spectrals?.status === 'succeeded' && lossyMasterMissingSpectral(state.draft))
    }
    case 'metadata':
      return taskById(state.background.tasks, 'metadata')?.status === 'failed'
    case 'tags':
      return pendingSeparatorArtists(state.tags.proposed).length > 0
    case 'transcode':
      return state.transcode?.phase === 'failed' || Boolean(state.transcode?.error)
    case 'upload':
      return state.upload?.phase === 'failed'
    case 'seed':
      return state.seed?.phase === 'failed'
    default:
      return false
  }
}

const TRANSCODE_STEP = stepIndexOf('transcode')

/** Transcode is hidden when skipped, unless the user is on it or it needs attention. */
export function transcodeStepHidden(state: UploadFlowStateJSON, skip: boolean): boolean {
  return skip && state.currentStep !== TRANSCODE_STEP && !stepHasError(TRANSCODE_STEP, state)
}

/** The next or previous step index, passing over a hidden Transcode step. */
export function adjacentStepIndex(
  state: UploadFlowStateJSON,
  direction: 1 | -1,
  skip: boolean
): number {
  const clamp = (index: number): number => Math.max(0, Math.min(UPLOAD_STEPS.length - 1, index))
  const index = clamp(state.currentStep + direction)
  return index === TRANSCODE_STEP && transcodeStepHidden(state, skip)
    ? clamp(index + direction)
    : index
}

export function activeBackgroundTasks(tasks: BackgroundTask[]): BackgroundTask[] {
  return tasks.filter((t) => t.status === 'queued' || t.status === 'running')
}

export function isTranscodeBusy(transcode: TranscodeSnapshot | undefined): boolean {
  const phase = transcode?.phase
  return phase === 'inspecting' || phase === 'running'
}

function taskById(tasks: BackgroundTask[], id: string): BackgroundTask | undefined {
  return tasks.find((t) => t.id === id)
}

export { highestReachableStep }
