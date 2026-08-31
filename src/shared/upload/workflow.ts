import type { BackgroundTask, StepID, TagsSnapshot, UploadFlowStateJSON } from '../types/upload'
import { pendingSeparatorArtists } from '../tags/editor'
import { WORKFLOW_STEPS, type WorkflowStep } from './steps'

export { WORKFLOW_STEPS, type WorkflowStep } from './steps'

/**
 * The upload pipeline is shared by the main process and renderer. Keep its
 * order, labels, and navigation rules here so the renderer only presents the
 * rules that the main process enforces.
 */
export type StepNavigation =
  | { ok: true; index: number; id: StepID }
  | { ok: false; error: string }

export function workflowStepIndex(id: StepID): number | null {
  const index = WORKFLOW_STEPS.findIndex((step) => step.id === id)
  return index >= 0 ? index : null
}

export function workflowStepAt(index: number): WorkflowStep | null {
  return WORKFLOW_STEPS[index] ?? null
}

export function highestReachableStep(state: UploadFlowStateJSON): number {
  const index = (id: StepID): number => workflowStepIndex(id) ?? 0
  let highest = index('file-checks')

  if (
    state.fileChecks.integrity.status !== 'passed' &&
    state.upload.phase !== 'submitting' &&
    state.upload.phase !== 'done'
  ) {
    return highest
  }
  if (!state.fileChecks.structure.ready) return highest

  const files = taskById(state.background.tasks, 'file-checks')
  if (files?.status === 'succeeded') highest = Math.max(highest, index('spectrals'))
  // A failed file checks does not gate: a tracker logchecker outage says
  // nothing about the release and can be retried from its own step.

  const spectrals = taskById(state.background.tasks, 'spectrals')
  if (spectrals?.status === 'succeeded') highest = Math.max(highest, index('metadata'))
  if (spectrals?.status === 'failed') return Math.max(highest, index('spectrals'))

  const metadata = taskById(state.background.tasks, 'metadata')
  if (metadata?.status === 'succeeded' || state.metadata.selected) {
    highest = Math.max(highest, index('tags'))
  }
  if (hasProposedTags(state.tags) || state.tags.releaseStatus === 'ready') {
    if (pendingSeparatorArtists(state.tags.proposed).length === 0) {
      highest = Math.max(highest, index('transcode'))
    }
  }

  const phase = state.transcode.phase
  if (phase === 'ready' || phase === 'done' || phase === 'failed' || phase === 'running') {
    highest = Math.max(highest, index('upload'))
  }
  if (state.upload.phase === 'done') highest = Math.max(highest, index('seed'))
  return Math.min(WORKFLOW_STEPS.length - 1, highest)
}

/** The main process calls this before every user-driven step transition. */
export function evaluateStepNavigation(
  state: UploadFlowStateJSON,
  targetIndex: number
): StepNavigation {
  const target = workflowStepAt(targetIndex)
  if (!target) return { ok: false, error: 'Unknown upload step.' }

  // Gates run earliest prerequisite first, so a user jumping ahead is told the
  // first thing to fix rather than the last.
  const goingForward = targetIndex > state.currentStep
  const firstStepAfterMedia = workflowStepIndex('spectrals') ?? 0
  if (goingForward && targetIndex >= firstStepAfterMedia && !state.draft.sourceMedia) {
    return { ok: false, error: 'Choose WEB or CD source media before continuing.' }
  }
  if (
    goingForward &&
    targetIndex >= firstStepAfterMedia &&
    !state.fileChecks.structure.ready &&
    state.upload.phase !== 'submitting' &&
    state.upload.phase !== 'done'
  ) {
    return {
      ok: false,
      error: 'Resolve the folder and file checks before continuing.'
    }
  }
  if (
    goingForward &&
    targetIndex >= firstStepAfterMedia &&
    state.fileChecks.integrity.status !== 'passed' &&
    state.upload.phase !== 'submitting' &&
    state.upload.phase !== 'done'
  ) {
    return {
      ok: false,
      error: state.fileChecks.integrity.status === 'idle'
        ? 'Wait for the FLAC integrity check to finish.'
        : 'Repair failed FLAC integrity checks before continuing.'
    }
  }
  const tagsStep = workflowStepIndex('tags') ?? WORKFLOW_STEPS.length
  if (goingForward && state.currentStep < tagsStep && targetIndex >= tagsStep && !state.metadata.selected) {
    return { ok: false, error: 'Choose a metadata source before opening Tags & Filenames.' }
  }
  const transcodeStep = workflowStepIndex('transcode') ?? WORKFLOW_STEPS.length
  if (
    goingForward &&
    targetIndex >= transcodeStep &&
    pendingSeparatorArtists(state.tags.proposed).length > 0
  ) {
    return { ok: false, error: 'Choose how to read artist names that contain separators.' }
  }
  // Seed is the one step a user cannot revisit on the strength of having been
  // there before: it needs a submitted upload every time.
  if (target.id === 'seed' && state.upload.phase !== 'done') {
    return { ok: false, error: 'Submit the upload before opening Seed.' }
  }
  if (!goingForward) return { ok: true, index: targetIndex, id: target.id }

  if (targetIndex > highestReachableStep(state) + 1) {
    return { ok: false, error: `Complete the earlier upload steps before opening ${target.title}.` }
  }
  return { ok: true, index: targetIndex, id: target.id }
}

function taskById(tasks: BackgroundTask[], id: string): BackgroundTask | undefined {
  return tasks.find((task) => task.id === id)
}

// setTagsReleaseLoading parks an empty object in `proposed`, so its presence
// alone says nothing — only a populated one means tags are ready to work with.
function hasProposedTags(tags: TagsSnapshot): boolean {
  const proposed = tags.proposed
  return Boolean(proposed && Object.keys(proposed).length > 0)
}
