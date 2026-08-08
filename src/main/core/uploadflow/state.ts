import { basename } from 'node:path'
import type {
  BackgroundWork,
  Draft,
  FilesCheckSnapshot,
  FilesSnapshot,
  FlaccheckSummary,
  MetadataSearchSnapshot,
  SourceMedia,
  StepID,
  TagsSnapshot,
  TranscodeSnapshot,
  UploadSnapshot,
  SeedSnapshot
} from '@shared/types'
import { WORKFLOW_STEPS, workflowStepAt, workflowStepIndex } from '@shared/upload/workflow'
import { emptyFlaccheckSummary } from '@main/core/tools/spectrals/flaccheck'
import { newBackgroundWork, withSourceMedia } from './background'
import { emptyFilesCheck } from './filesCheck'
import { emptyFiles } from './files'
import { emptySeed } from './seed'
import { emptyTranscode } from './transcode'
import { emptyUpload } from './upload'

export const STEPS = WORKFLOW_STEPS

export const SOURCE_MEDIA_OPTIONS: SourceMedia[] = ['WEB', 'CD']

export interface State {
  currentStep: number
  draft: Draft
  background: BackgroundWork
  metadata: MetadataSearchSnapshot
  tags: TagsSnapshot
  files: FilesSnapshot
  transcode: TranscodeSnapshot
  flaccheck: FlaccheckSummary
  filesCheck: FilesCheckSnapshot
  upload: UploadSnapshot
  seed: SeedSnapshot
}

function emptyDraft(): Draft {
  return {
    sourcePath: '',
    workspacePath: '',
    sourceMedia: '',
    lossyMaster: false,
    lossyComment: '',
    spectralIds: [],
    spectralIdsAuto: true
  }
}

export function newState(): State {
  return {
    currentStep: 0,
    draft: emptyDraft(),
    background: { sourcePath: '', sourceMedia: '', tasks: [] },
    metadata: {},
    tags: {},
    files: emptyFiles(),
    transcode: emptyTranscode(),
    flaccheck: emptyFlaccheckSummary(),
    filesCheck: emptyFilesCheck(),
    upload: emptyUpload(),
    seed: emptySeed()
  }
}

export function steps(): typeof WORKFLOW_STEPS[number][] {
  return STEPS.map((s) => ({ ...s }))
}

export function sourceMediaOptions(): SourceMedia[] {
  return [...SOURCE_MEDIA_OPTIONS]
}

export function currentStepIndex(s: State): number {
  return s.currentStep
}

export function currentStep(s: State): typeof WORKFLOW_STEPS[number] {
  return workflowStepAt(s.currentStep) ?? WORKFLOW_STEPS[0]
}

export function draft(s: State): Draft {
  return { ...s.draft }
}

export function backgroundWork(s: State): BackgroundWork {
  return {
    ...s.background,
    tasks: s.background.tasks.map((t) => ({ ...t }))
  }
}

export function sourcePath(s: State): string {
  return s.draft.sourcePath
}

export function sourceMedia(s: State): SourceMedia | '' {
  return s.draft.sourceMedia
}

export function workspacePath(s: State): string {
  return s.draft.workspacePath
}

export function lossyMaster(s: State): boolean {
  return s.draft.lossyMaster
}

export function lossyComment(s: State): string {
  return s.draft.lossyComment
}

export function spectralIds(s: State): number[] {
  return [...s.draft.spectralIds]
}

export function spectralIdsAuto(s: State): boolean {
  return s.draft.spectralIdsAuto
}

export function stepperTitle(s: State): string {
  if (s.draft.sourcePath === '') {
    return 'Uploader'
  }
  return basename(s.draft.sourcePath)
}

export function setCurrentStep(s: State, index: number): State {
  if (index < 0) index = 0
  if (index >= STEPS.length) index = STEPS.length - 1
  return { ...s, currentStep: index }
}

export function selectSourcePath(s: State, path: string): State {
  if (path !== s.draft.sourcePath) {
    return {
      ...s,
      draft: { ...emptyDraft(), sourcePath: path },
      background: newBackgroundWork(path),
      metadata: {},
      tags: {},
      files: emptyFiles(),
      transcode: emptyTranscode(),
      flaccheck: emptyFlaccheckSummary(),
      filesCheck: emptyFilesCheck(),
      upload: emptyUpload(),
      seed: emptySeed()
    }
  }
  return {
    ...s,
    draft: { ...s.draft, sourcePath: path }
  }
}

export function setWorkspacePath(s: State, path: string): State {
  return {
    ...s,
    draft: { ...s.draft, workspacePath: path }
  }
}

export function setLossyMaster(s: State, value: boolean): State {
  return {
    ...s,
    draft: { ...s.draft, lossyMaster: value }
  }
}

export function setLossyComment(s: State, value: string): State {
  return {
    ...s,
    draft: { ...s.draft, lossyComment: value }
  }
}

/** A hand-made choice, which the settings default must not overwrite later. */
export function setSpectralIds(s: State, ids: number[]): State {
  return {
    ...s,
    draft: { ...s.draft, spectralIds: sortedIds(ids), spectralIdsAuto: false }
  }
}

/** The settings pre-selection. Ignored once the user has chosen for themselves. */
export function setDefaultSpectralIds(s: State, ids: number[]): State {
  if (!s.draft.spectralIdsAuto) return s
  return {
    ...s,
    draft: { ...s.draft, spectralIds: sortedIds(ids) }
  }
}

function sortedIds(ids: number[]): number[] {
  return [...new Set(ids)].sort((a, b) => a - b)
}

export function setSourceMedia(s: State, media: SourceMedia): State {
  if (s.draft.sourcePath === '') {
    return s
  }
  return {
    ...s,
    draft: { ...s.draft, sourceMedia: media },
    background: withSourceMedia(s.background, media)
  }
}

export function stepIndex(id: StepID): number | null {
  return workflowStepIndex(id)
}

export function toJSON(s: State): State {
  return structuredClone(s)
}
