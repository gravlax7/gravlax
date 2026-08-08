/**
 * Staleness bookkeeping for the long-running tasks `UploadSession` spawns.
 *
 * Every one of them has the same hazard: it awaits a tool or a network call,
 * and by the time it comes back the user may have picked a different source,
 * cleared the cache, or asked for the same task again. Applying the result
 * then would overwrite newer state with older.
 *
 * A `TaskSlot` holds one task's abort controller and run counter, so starting
 * a run supersedes the previous one and `handle.fresh()` is the single check
 * that has to pass after every await. A `TaskScope` groups the slots so a
 * source change can invalidate all of them at once.
 */

export interface TaskHandle {
  readonly signal: AbortSignal
  /**
   * False once this run has been superseded by a newer one, aborted, or
   * invalidated by its scope. Check it after every await, before applying
   * anything to state.
   */
  fresh(): boolean
}

export function isAbortError(err: unknown): boolean {
  return (err as Error | undefined)?.name === 'AbortError'
}

export class TaskSlot {
  private runID = 0
  private controller: AbortController | null = null

  constructor(private readonly scope: TaskScope) {}

  /** Abort the running task, if any, and make its results unusable. */
  cancel(): void {
    this.controller?.abort()
    this.controller = null
    // Aborting is not enough on its own: work already past an await would
    // otherwise finish and apply its results over the new state.
    this.runID++
  }

  /**
   * Claim the slot for a new run, superseding any previous one. `guard` is
   * folded into `fresh()` — use it for the per-task preconditions, typically
   * that the workspace has not been swapped underneath.
   */
  begin(guard?: () => boolean): TaskHandle {
    this.cancel()
    const controller = new AbortController()
    this.controller = controller
    const runID = this.runID
    const generation = this.scope.generation

    return {
      signal: controller.signal,
      fresh: () =>
        runID === this.runID &&
        generation === this.scope.generation &&
        !controller.signal.aborted &&
        (guard?.() ?? true)
    }
  }

  /**
   * Run `body` in this slot. Aborts and failures from a superseded run are
   * swallowed; anything else reaches `onError`.
   */
  async run(
    body: (handle: TaskHandle) => Promise<void>,
    options: { guard?: () => boolean; onError?: (err: unknown) => void } = {}
  ): Promise<void> {
    const handle = this.begin(options.guard)
    try {
      await body(handle)
    } catch (err) {
      if (isAbortError(err) || !handle.fresh()) return
      options.onError?.(err)
    }
  }
}

export class TaskScope {
  private slots = new Map<string, TaskSlot>()
  private counter = 0

  get generation(): number {
    return this.counter
  }

  slot(name: string): TaskSlot {
    let slot = this.slots.get(name)
    if (!slot) {
      slot = new TaskSlot(this)
      this.slots.set(name, slot)
    }
    return slot
  }

  /**
   * Everything in flight is stale — the workspace changed under it. Bumping
   * the generation covers tasks that have no slot of their own as well.
   */
  invalidateAll(): void {
    this.counter++
    for (const slot of this.slots.values()) slot.cancel()
  }
}
