import type { Config } from '@shared/types/config'
import type { NotifyPayload, UploadFlowStateJSON } from '@shared/types'
import { snapshot, newState, type State } from '@main/core/uploadflow'
import { uploadWorkspaceRootForPath, writeUploadFlow } from '@main/core/appdata/workspace'

// Typing in a comment or description box applies state per keystroke. Coalesce
// those into one write instead of one file write per character.
const PERSIST_DEBOUNCE_MS = 300

export interface UploadSessionRuntimeDeps {
  userDataPath: string
  getConfig: () => Config
  send: (channel: string, payload: unknown) => void
}

/** Owns session state delivery and durable snapshots, not workflow effects. */
export class UploadSessionRuntime {
  private state: State = newState()
  private pushTimer: ReturnType<typeof setTimeout> | null = null
  private persistTimer: ReturnType<typeof setTimeout> | null = null
  private persistChain: Promise<void> = Promise.resolve()

  constructor(readonly deps: UploadSessionRuntimeDeps) {}

  get current(): State {
    return this.state
  }

  getState(): UploadFlowStateJSON {
    return structuredClone(this.state) as UploadFlowStateJSON
  }

  apply(next: State, options: { persist?: boolean } = {}): void {
    this.state = next
    this.pushState()
    if (options.persist !== false) this.schedulePersist()
  }

  notify(level: NotifyPayload['level'], message: string): void {
    this.deps.send('upload:notify', { level, message } satisfies NotifyPayload)
  }

  async flushPersist(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
      this.queuePersist()
    }
    await this.persistChain
  }

  /** Writes even after transient progress updates that skipped persistence. */
  async persistNow(): Promise<void> {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer)
      this.persistTimer = null
    }
    this.queuePersist()
    await this.persistChain
  }

  private pushState(): void {
    if (this.pushTimer) return
    this.pushTimer = setTimeout(() => {
      this.pushTimer = null
      this.deps.send('upload:state', this.getState())
    }, 60)
  }

  private async persist(): Promise<void> {
    if (!this.state.draft.workspacePath) return
    try {
      await writeUploadFlow(
        uploadWorkspaceRootForPath(this.state.draft.workspacePath),
        snapshot(this.state)
      )
    } catch {
      this.notify('warning', 'Could not save upload progress.')
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer) return
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null
      this.queuePersist()
    }, PERSIST_DEBOUNCE_MS)
  }

  private queuePersist(): void {
    this.persistChain = this.persistChain.then(() => this.persist())
  }
}
