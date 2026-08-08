import type { BackgroundTask, Step, StepID, TagsSnapshot, UploadFlowStateJSON } from '../types/upload'

/**
 * The upload pipeline is shared by the main process and renderer. Keep its
 * order, labels, and navigation rules here so the renderer only presents the
 * rules that the main process enforces.
 */
export const WORKFLOW_STEPS = [
  { id: 'files-check', title: 'Files Check', body: '' },
  {
    id: 'spectrals',
    title: 'Spectrals',
    body: 'Review generated spectrals and decide whether the upload should be reported as lossy master.'
  },
  { id: 'metadata', title: 'Metadata', body: '' },
  { id: 'tags', title: 'Tags & Filenames', body: '' },
  {
    id: 'transcode',
    title: 'Transcode',
    body: 'Prepare any downconversion work needed before upload.'
  },
  {
    id: 'upload',
    title: 'Upload',
    body: 'Review the final payload and submit it to the target tracker.'
  },
  {
    id: 'seed',
    title: 'Seed',
    body: 'Hand the finished torrent to the chosen client or remote target.'
  }
] as const satisfies readonly Step[]

export type WorkflowStep = (typeof WORKFLOW_STEPS)[number]

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
  let highest = index('files-check')

  const files = taskById(state.background.tasks, 'files-check')
  if (files?.status === 'succeeded') highest = Math.max(highest, index('spectrals'))
  // A failed files check does not gate: a tracker logchecker outage says
  // nothing about the release and can be retried from its own step.

  const spectrals = taskById(state.background.tasks, 'spectrals')
  if (spectrals?.status === 'succeeded') highest = Math.max(highest, index('metadata'))
  if (spectrals?.status === 'failed') return Math.max(highest, index('spectrals'))

  const metadata = taskById(state.background.tasks, 'metadata')
  if (metadata?.status === 'succeeded' || state.metadata.selected) {
    highest = Math.max(highest, index('tags'))
  }
  if (hasProposedTags(state.tags) || state.tags.releaseStatus === 'ready') {
    highest = Math.max(highest, index('transcode'))
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
