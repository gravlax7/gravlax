import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import { newState, stepIndex, type State } from '@main/core/uploadflow'
import { UploadSession } from '@main/services/uploadSession'

describe('UploadSession', () => {
  it('keeps a description edit made while building the upload report', async () => {
    const session = new UploadSession({
      userDataPath: '',
      getConfig: defaultConfig,
      send: () => undefined
    })
    const state = newState()
    state.currentStep = stepIndex('upload') ?? 6
    state.tags.proposed = { title: 'Album' }

    const runtime = (
      session as unknown as { runtime: { apply: (next: State) => void } }
    ).runtime
    runtime.apply(state)

    const building = session.ensureUploadReport()
    session.updateUploadReport({ albumDesc: 'My edited description' })
    await building
    await session.flushPersist()

    expect(session.getState().upload.albumDesc).toBe('My edited description')
  })
})
