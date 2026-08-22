import { describe, expect, it } from 'vitest'
import { TaskScope, isAbortError } from '@main/services/taskSlot'

function abortError(): Error {
  const err = new Error('Aborted')
  err.name = 'AbortError'
  return err
}

describe('TaskSlot', () => {
  it('supersedes the previous run in the same slot', () => {
    const slot = new TaskScope().slot('spectrals')
    const first = slot.begin()
    expect(first.fresh()).toBe(true)

    const second = slot.begin()
    expect(first.fresh()).toBe(false)
    expect(second.fresh()).toBe(true)
    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })

  it('leaves other slots alone', () => {
    const scope = new TaskScope()
    const spectrals = scope.slot('spectrals').begin()
    scope.slot('metadata').begin()
    expect(spectrals.fresh()).toBe(true)
  })

  it('invalidates every slot when the scope turns over', () => {
    const scope = new TaskScope()
    const spectrals = scope.slot('spectrals').begin()
    const metadata = scope.slot('metadata').begin()

    scope.invalidateAll()

    expect(spectrals.fresh()).toBe(false)
    expect(metadata.fresh()).toBe(false)
    expect(spectrals.signal.aborted).toBe(true)
  })

  it('invalidates a run started before the scope turned over, even in a fresh slot', () => {
    const scope = new TaskScope()
    const handle = scope.slot('files-check').begin()
    scope.invalidateAll()
    // Same slot, but the handle predates the turnover.
    expect(handle.fresh()).toBe(false)
  })

  it('folds the caller guard into fresh()', () => {
    const scope = new TaskScope()
    let workspace = '/ws/a'
    const handle = scope.slot('tags').begin(() => workspace === '/ws/a')
    expect(handle.fresh()).toBe(true)
    workspace = '/ws/b'
    expect(handle.fresh()).toBe(false)
  })

  it('cancel() stops a run without touching the scope', () => {
    const scope = new TaskScope()
    const slot = scope.slot('seed')
    const handle = slot.begin()
    slot.cancel()
    expect(handle.fresh()).toBe(false)
    expect(scope.slot('metadata').begin().fresh()).toBe(true)
  })
})

describe('TaskSlot.run', () => {
  it('aborts a run and waits for its cleanup to finish', async () => {
    const slot = new TaskScope().slot('spectrals')
    let finishCleanup!: () => void
    const cleanup = new Promise<void>((resolve) => { finishCleanup = resolve })
    let handleSignal: AbortSignal | undefined
    const running = slot.run(async (handle) => {
      handleSignal = handle.signal
      await cleanup
    })

    let stopped = false
    const stopping = slot.cancelAndWait().then(() => { stopped = true })
    await Promise.resolve()

    expect(handleSignal?.aborted).toBe(true)
    expect(stopped).toBe(false)
    finishCleanup()
    await stopping
    await running
    expect(stopped).toBe(true)
  })

  it('reports a genuine failure', async () => {
    const errors: string[] = []
    await new TaskScope().slot('metadata').run(
      async () => {
        throw new Error('boom')
      },
      { onError: (err) => errors.push(String(err)) }
    )
    expect(errors).toEqual(['Error: boom'])
  })

  it('swallows aborts', async () => {
    const errors: string[] = []
    await new TaskScope().slot('metadata').run(
      async () => {
        throw abortError()
      },
      { onError: (err) => errors.push(String(err)) }
    )
    expect(errors).toEqual([])
  })

  it('swallows failures from a run that has been superseded', async () => {
    const errors: string[] = []
    const slot = new TaskScope().slot('metadata')
    const first = slot.run(
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        throw new Error('boom')
      },
      { onError: (err) => errors.push(String(err)) }
    )
    slot.begin()
    await first
    expect(errors).toEqual([])
  })
})

describe('isAbortError', () => {
  it('recognises AbortError and nothing else', () => {
    expect(isAbortError(abortError())).toBe(true)
    expect(isAbortError(new Error('boom'))).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
  })
})
