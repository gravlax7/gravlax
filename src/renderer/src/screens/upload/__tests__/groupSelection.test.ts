import { createEffect, createRoot, createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { UploadSnapshot } from '@shared/types'
import { createSelectedGroupId } from '../groupSelection'

async function flushEffects(): Promise<void> {
  await Promise.resolve()
}

describe('selected group ID', () => {
  it('does not wake its dependants when unrelated upload state changes', async () => {
    const request = vi.fn()
    let setUpload!: (upload: Pick<UploadSnapshot, 'groupIds'>) => void
    let dispose!: () => void

    createRoot((rootDispose) => {
      dispose = rootDispose
      const [upload, updateUpload] = createSignal<Pick<UploadSnapshot, 'groupIds'>>({
        groupIds: { redacted: 123 }
      })
      setUpload = updateUpload
      const groupId = createSelectedGroupId(upload, () => 'redacted')

      createEffect(() => {
        const id = groupId()
        if (id != null) request(id)
      })
    })

    await flushEffects()
    expect(request).toHaveBeenCalledOnce()

    setUpload({ groupIds: { redacted: 123, orpheus: 456 } })
    await flushEffects()
    expect(request).toHaveBeenCalledOnce()

    setUpload({ groupIds: { redacted: 789, orpheus: 456 } })
    await flushEffects()
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenLastCalledWith(789)

    dispose()
  })
})
