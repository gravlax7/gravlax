import { createEffect, createRoot, createSignal, flush } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import type { UploadSnapshot } from '@shared/types'
import { createSelectedGroupId } from '../groupSelection'

describe('selected group ID', () => {
  it('does not wake its dependants when unrelated upload state changes', () => {
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

      createEffect(
        () => groupId(),
        (id) => {
          if (id != null) request(id)
        }
      )
    })

    flush()
    expect(request).toHaveBeenCalledOnce()

    setUpload({ groupIds: { redacted: 123, orpheus: 456 } })
    flush()
    expect(request).toHaveBeenCalledOnce()

    setUpload({ groupIds: { redacted: 789, orpheus: 456 } })
    flush()
    expect(request).toHaveBeenCalledTimes(2)
    expect(request).toHaveBeenLastCalledWith(789)

    dispose()
  })
})
