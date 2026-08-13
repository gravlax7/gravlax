import { describe, expect, it } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import { newState, stepIndex, type State } from '@main/core/uploadflow'
import { UploadSession } from '@main/services/uploadSession'
import { automaticToolResolver } from '@main/core/tools/binaries'

describe('UploadSession', () => {
  it('keeps a description edit made while building the upload report', async () => {
    const session = new UploadSession({
      appVersion: '9.8.7',
      userDataPath: '',
      getConfig: defaultConfig,
      tools: automaticToolResolver,
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

  it('uses the running app version in the upload report', async () => {
    const session = new UploadSession({
      appVersion: '9.8.7',
      userDataPath: '',
      getConfig: defaultConfig,
      tools: automaticToolResolver,
      send: () => undefined
    })
    const state = newState()
    state.currentStep = stepIndex('upload') ?? 6
    state.tags.proposed = { title: 'Album' }

    const runtime = (
      session as unknown as { runtime: { apply: (next: State) => void } }
    ).runtime
    runtime.apply(state)

    await session.ensureUploadReport()

    expect(session.getState().upload.formats?.[0]?.releaseDesc).toContain(
      '[hr]Uploaded with [b]gravlax[/b] v9.8.7'
    )
  })
})
