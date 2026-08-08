import type {
  BackgroundTask,
  BackgroundTaskID,
  BackgroundTaskStatus,
  BackgroundWork,
  SourceMedia,
  StepID,
  TaskSnapshot
} from '@shared/types'

// Everything here reads the audio files and nothing else, so it can start the
// moment there is a folder. None of it cares whether the release is WEB or CD.
export function newBackgroundWork(sourcePath: string): BackgroundWork {
  if (sourcePath === '') {
    return { sourcePath: '', sourceMedia: '', tasks: [] }
  }
  return {
    sourcePath,
    sourceMedia: '',
    tasks: [
      queuedTask('spectrals', 'spectrals', 'Generate spectrals'),
      queuedTask('metadata', 'metadata', 'Fetch metadata tags'),
      queuedTask('transcode', 'transcode', 'Transcoding...')
    ]
  }
}

// Files check is the one job that needs the media type, because only CD rips
// carry logs for the tracker's logchecker. Keep it alone here: anything else
// queued off the media choice would be waiting on an answer it never needed,
// and would be cancelled and rerun whenever the user corrects that answer.
export function withSourceMedia(w: BackgroundWork, media: SourceMedia): BackgroundWork {
  if (w.sourcePath === '') {
    return w
  }
  const next: BackgroundWork = { ...w, sourceMedia: media, tasks: w.tasks.map((t) => ({ ...t })) }
  return withTask(next, queuedTask('files-check', 'files-check', 'Analyze release contents'))
}

function queuedTask(id: BackgroundTaskID, step: StepID, title: string): BackgroundTask {
  return {
    id,
    step,
    title,
    status: 'queued',
    detail: '',
    progressCurrent: 0,
    progressTotal: 0,
    progressLabel: ''
  }
}

export function started(w: BackgroundWork): boolean {
  return w.tasks.length > 0
}

export function taskCount(w: BackgroundWork): number {
  return w.tasks.length
}

export function queuedCount(w: BackgroundWork): number {
  return count(w, 'queued')
}

export function runningCount(w: BackgroundWork): number {
  return count(w, 'running')
}

export function completedCount(w: BackgroundWork): number {
  return count(w, 'succeeded') + count(w, 'failed')
}

export function active(w: BackgroundWork): boolean {
  return queuedCount(w) > 0 || runningCount(w) > 0
}

export function nextQueuedTask(w: BackgroundWork): BackgroundTask | null {
  return w.tasks.find((t) => t.status === 'queued') ?? null
}

export function task(w: BackgroundWork, id: BackgroundTaskID): BackgroundTask | null {
  return w.tasks.find((t) => t.id === id) ?? null
}

export function withTask(w: BackgroundWork, newTask: BackgroundTask): BackgroundWork {
  const tasks = w.tasks.map((t) => ({ ...t }))
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i]!.id !== newTask.id) continue
    tasks[i] = { ...newTask }
    return { ...w, tasks }
  }
  return { ...w, tasks: [...tasks, { ...newTask }] }
}

export function withTaskStatus(
  w: BackgroundWork,
  id: BackgroundTaskID,
  status: BackgroundTaskStatus,
  detail: string
): BackgroundWork {
  const tasks = w.tasks.map((t) => ({ ...t }))
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i]!.id !== id) continue
    tasks[i] = { ...tasks[i]!, status, detail }
    return { ...w, tasks }
  }
  return w
}

export function withTaskProgress(
  w: BackgroundWork,
  id: BackgroundTaskID,
  current: number,
  total: number,
  label: string
): BackgroundWork {
  const tasks = w.tasks.map((t) => ({ ...t }))
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i]!.id !== id) continue
    tasks[i] = {
      ...tasks[i]!,
      progressCurrent: current,
      progressTotal: total,
      progressLabel: label
    }
    return { ...w, tasks }
  }
  return w
}

export function resetTask(w: BackgroundWork, id: BackgroundTaskID): BackgroundWork {
  const tasks = w.tasks.map((t) => ({ ...t }))
  for (let i = 0; i < tasks.length; i++) {
    if (tasks[i]!.id !== id) continue
    tasks[i] = {
      ...tasks[i]!,
      status: 'queued',
      detail: '',
      progressCurrent: 0,
      progressTotal: 0,
      progressLabel: ''
    }
    return { ...w, tasks }
  }
  return w
}

export function withTaskSnapshotStatuses(
  w: BackgroundWork,
  tasksByID: Partial<Record<BackgroundTaskID, TaskSnapshot>>
): BackgroundWork {
  const tasks = w.tasks.map((t) => ({ ...t }))
  for (let i = 0; i < tasks.length; i++) {
    const snapshot = tasksByID[tasks[i]!.id]
    if (!snapshot) continue
    let status = snapshot.status
    if (status === 'running') {
      status = 'queued'
    }
    tasks[i] = { ...tasks[i]!, status }
    if (status === 'queued') {
      tasks[i] = {
        ...tasks[i]!,
        detail: '',
        progressCurrent: 0,
        progressTotal: 0,
        progressLabel: ''
      }
      continue
    }
    tasks[i] = {
      ...tasks[i]!,
      detail: snapshot.detail ?? '',
      progressCurrent: snapshot.progressCurrent ?? 0,
      progressTotal: snapshot.progressTotal ?? 0,
      progressLabel: snapshot.progressLabel ?? ''
    }
  }
  return { ...w, tasks }
}

function count(w: BackgroundWork, status: BackgroundTaskStatus): number {
  return w.tasks.filter((t) => t.status === status).length
}

export function markBackgroundTaskRunning(s: import('./state').State, id: BackgroundTaskID): import('./state').State {
  return { ...s, background: withTaskStatus(s.background, id, 'running', '') }
}

export function markBackgroundTaskCompleted(
  s: import('./state').State,
  id: BackgroundTaskID,
  detail: string
): import('./state').State {
  return { ...s, background: withTaskStatus(s.background, id, 'succeeded', detail) }
}

export function markBackgroundTaskProgress(
  s: import('./state').State,
  id: BackgroundTaskID,
  current: number,
  total: number,
  label: string
): import('./state').State {
  return { ...s, background: withTaskProgress(s.background, id, current, total, label) }
}

export function markBackgroundTaskFailed(
  s: import('./state').State,
  id: BackgroundTaskID,
  detail: string
): import('./state').State {
  return { ...s, background: withTaskStatus(s.background, id, 'failed', detail) }
}

export function resetBackgroundTask(s: import('./state').State, id: BackgroundTaskID): import('./state').State {
  return { ...s, background: resetTask(s.background, id) }
}
