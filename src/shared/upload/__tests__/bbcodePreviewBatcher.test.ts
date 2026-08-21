import { describe, expect, it, vi } from 'vitest'
import { createBbcodePreviewBatcher } from '../bbcodePreviewBatcher'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('createBbcodePreviewBatcher', () => {
  it('combines previews requested in the same turn', async () => {
    const load = vi.fn(async (source: string) => {
      const marker = source.slice('first'.length, -'second'.length)
      return `<strong>first</strong>${marker}<em>second</em>`
    })
    const preview = createBbcodePreviewBatcher(load)

    const results = await Promise.all([preview('first'), preview('second')])

    expect(results).toEqual(['<strong>first</strong>', '<em>second</em>'])
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('waits for the current batch before starting the next one', async () => {
    const first = deferred<string>()
    const started: string[] = []
    const load = vi.fn((source: string) => {
      started.push(source)
      return source === 'first' ? first.promise : Promise.resolve('second html')
    })
    const preview = createBbcodePreviewBatcher(load)

    const firstResult = preview('first')
    await Promise.resolve()
    const secondResult = preview('second')
    await Promise.resolve()
    expect(started).toEqual(['first'])

    first.resolve('first html')
    await expect(firstResult).resolves.toBe('first html')
    await expect(secondResult).resolves.toBe('second html')
    expect(started).toEqual(['first', 'second'])
  })

  it('continues after a failed batch', async () => {
    const load = vi
      .fn<(source: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error('failed'))
      .mockResolvedValueOnce('next html')
    const preview = createBbcodePreviewBatcher(load)

    const failed = preview('failed')
    await Promise.resolve()
    const next = preview('next')

    await expect(failed).rejects.toThrow('failed')
    await expect(next).resolves.toBe('next html')
  })
})
