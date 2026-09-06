import { describe, expect, it, vi } from 'vitest'
import { createBbcodePreview } from '../bbcodePreview'
import { createBbcodePreviewBatcher } from '../bbcodePreviewBatcher'

const settle = async () => {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('editor previews', () => {
  it('batches album, release, and open lossy editor previews once the upload is ready', async () => {
    const load = vi.fn(async (source: string) => source.replaceAll('[b]', '<b>').replaceAll('[/b]', '</b>'))
    const batched = createBbcodePreviewBatcher(load)
    const listeners = [vi.fn(), vi.fn(), vi.fn()]
    const previews = listeners.map((listener) => createBbcodePreview(batched, listener))
    const sources = ['[b]Album[/b]', '[b]Release[/b]', '[b]Lossy report[/b]']
    previews.forEach((preview, i) => preview.update(sources[i]!, i === 2, false))
    await settle()
    expect(load).not.toHaveBeenCalled()

    previews.forEach((preview, i) => preview.update(sources[i]!, i === 2, true))
    await settle()
    expect(load).toHaveBeenCalledTimes(1)
    listeners.forEach((listener, i) => expect(listener).toHaveBeenLastCalledWith({
      html: sources[i]!.replace('[b]', '<b>').replace('[/b]', '</b>'), loading: false, error: null
    }))

    previews[2]!.update(sources[2]!, false, true)
    await settle()
    expect(load).toHaveBeenCalledTimes(1)

    previews[2]!.update('Typing', true, true)
    previews[2]!.update('Typing more', true, true)
    await settle()
    expect(load).toHaveBeenCalledTimes(1)

    previews[2]!.update('Typing more', false, true)
    await settle()
    expect(load).toHaveBeenCalledTimes(2)
    expect(listeners[2]).toHaveBeenLastCalledWith({ html: 'Typing more', loading: false, error: null })
  })

  it('shares an in-flight preload when the user opens the preview', async () => {
    let resolve!: (html: string) => void
    const load = vi.fn(() => new Promise<string>((done) => { resolve = done }))
    const changed = vi.fn()
    const preview = createBbcodePreview(load, changed)
    preview.update('comment', true, true)
    preview.update('comment', false, true)
    expect(load).toHaveBeenCalledTimes(1)
    resolve('rendered')
    await settle()
    expect(changed).toHaveBeenLastCalledWith({ html: 'rendered', loading: false, error: null })
  })

  it('ignores stale responses, including after returning to a cached preview', async () => {
    let resolve!: (html: string) => void
    const load = vi.fn().mockResolvedValueOnce('original html')
      .mockImplementationOnce(() => new Promise<string>((done) => { resolve = done }))
    const changed = vi.fn()
    const preview = createBbcodePreview(load, changed)
    preview.update('original', false, true)
    await settle()
    preview.update('new', false, true)
    preview.update('original', false, true)
    resolve('stale html')
    await settle()
    expect(changed).toHaveBeenLastCalledWith({ html: 'original html', loading: false, error: null })
  })

  it('allows retry after failure and ignores responses after disposal', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('Preview failed')).mockResolvedValueOnce('html')
    const changed = vi.fn()
    const preview = createBbcodePreview(load, changed)
    preview.update('comment', true, true)
    await settle()
    expect(changed).toHaveBeenLastCalledWith({ html: '', loading: false, error: 'Preview failed' })
    preview.retry('comment')
    preview.dispose()
    const calls = changed.mock.calls.length
    await settle()
    expect(changed).toHaveBeenCalledTimes(calls)
  })
})
