import type {
  TranscodeInspection,
  TranscodeJobResult,
  TranscodePhase,
  TranscodeSnapshot
} from '@shared/types'
import type { State } from './state'

export function emptyTranscode(): TranscodeSnapshot {
  return {
    phase: 'idle',
    selectedOptionIds: [],
    essentialOnly: true,
    jobs: []
  }
}

export function setTranscode(s: State, snapshot: TranscodeSnapshot): State {
  return { ...s, transcode: restoreTranscode(snapshot) }
}

export function setTranscodePhase(s: State, phase: TranscodePhase, error = ''): State {
  return {
    ...s,
    transcode: { ...s.transcode, phase, error: error || undefined }
  }
}

export function setTranscodeInspection(s: State, inspection: TranscodeInspection): State {
  const available = new Set(inspection.options.map((o) => o.id))
  const selected = (s.transcode.selectedOptionIds ?? []).filter((id) => available.has(id))
  return {
    ...s,
    transcode: {
      ...s.transcode,
      phase: 'ready',
      inspection,
      selectedOptionIds: selected,
      jobs: [],
      error: undefined
    }
  }
}

export function setTranscodeSelection(s: State, optionIds: string[]): State {
  const available = new Set((s.transcode.inspection?.options ?? []).map((o) => o.id))
  return {
    ...s,
    transcode: {
      ...s.transcode,
      selectedOptionIds: optionIds.filter((id) => available.has(id))
    }
  }
}

export function setTranscodeEssentialOnly(s: State, essentialOnly: boolean): State {
  return {
    ...s,
    transcode: { ...s.transcode, essentialOnly }
  }
}

export function setTranscodeJobs(s: State, jobs: TranscodeJobResult[]): State {
  return {
    ...s,
    transcode: { ...s.transcode, jobs: jobs.map((j) => ({ ...j })) }
  }
}

export function updateTranscodeJob(s: State, job: TranscodeJobResult): State {
  const jobs = (s.transcode.jobs ?? []).map((j) => ({ ...j }))
  const index = jobs.findIndex((j) => j.optionId === job.optionId)
  if (index >= 0) {
    jobs[index] = { ...job }
  } else {
    jobs.push({ ...job })
  }
  return { ...s, transcode: { ...s.transcode, jobs } }
}

export function clearTranscode(s: State): State {
  return { ...s, transcode: emptyTranscode() }
}

export function restoreTranscode(snapshot: TranscodeSnapshot | undefined): TranscodeSnapshot {
  if (!snapshot) return emptyTranscode()
  let phase = snapshot.phase ?? 'idle'
  if (phase === 'inspecting' || phase === 'running') {
    phase = snapshot.inspection ? 'ready' : 'idle'
  }
  return {
    phase,
    inspection: snapshot.inspection
      ? {
          ...snapshot.inspection,
          options: snapshot.inspection.options.map((o) => ({ ...o })),
          blockers: snapshot.inspection.blockers.map((b) => ({ ...b }))
        }
      : undefined,
    selectedOptionIds: [...(snapshot.selectedOptionIds ?? [])],
    essentialOnly: snapshot.essentialOnly ?? true,
    jobs: (snapshot.jobs ?? []).map((j) => ({ ...j })),
    error: snapshot.error
  }
}
