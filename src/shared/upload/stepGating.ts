import type {
  BackgroundTask,
  StepID,
  TranscodeSnapshot,
  UploadFlowStateJSON
} from '../types/upload'
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
    case 'files-check':
      return state.filesCheck.integrity.status === 'failed' ||
        taskById(state.background.tasks, 'files-check')?.status === 'failed'
    case 'spectrals':
      return taskById(state.background.tasks, 'spectrals')?.status === 'failed'
    case 'metadata':
      return taskById(state.background.tasks, 'metadata')?.status === 'failed'
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
