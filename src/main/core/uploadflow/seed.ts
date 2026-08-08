import type { SeedSnapshot, SeedTask } from '@shared/types'
import type { State } from './state'

export function emptySeed(): SeedSnapshot {
  return { phase: 'idle', tasks: [] }
}

export function setSeed(s: State, seed: SeedSnapshot): State {
  return { ...s, seed: cloneSeed(seed) }
}

export function cloneSeed(seed: SeedSnapshot): SeedSnapshot {
  return {
    phase: seed.phase,
    error: seed.error,
    tasks: (seed.tasks ?? []).map((t) => ({ ...t }))
  }
}

export function patchSeedTask(
  seed: SeedSnapshot,
  taskId: string,
  patch: Partial<SeedTask>
): SeedSnapshot {
  return {
    ...seed,
    tasks: seed.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t))
  }
}

/**
 * A restored session has no transfer in flight, whatever the snapshot says.
 * Leaving a task at `running` would show a progress bar that never moves and
 * hide the Retry button behind a phase that never resolves.
 */
export function resumeSeed(s: State): State {
  if (s.seed.phase !== 'running') return s
  return setSeed(s, {
    ...s.seed,
    phase: 'failed',
    error: s.seed.error ?? 'Seeding was interrupted.',
    tasks: s.seed.tasks.map((task) =>
      task.status === 'running'
        ? { ...task, status: 'failed' as const, detail: 'Interrupted.' }
        : task
    )
  })
}
