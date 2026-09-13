import { describe, expect, it } from 'vitest'
import { UploadSession } from '@main/services/uploadSession'
import { automaticToolResolver } from '@main/core/tools/binaries'
import { defaultConfig } from '@main/core/config/defaults'

function newSession(): UploadSession {
  return new UploadSession({
    appVersion: 'test',
    userDataPath: '/userdata',
    getConfig: () => defaultConfig(),
    trashItem: async () => undefined,
    tools: automaticToolResolver,
    send: () => {}
  })
}

describe('workspace staleness', () => {
  it('enforces workflow gates in the main process', async () => {
    const session = newSession()

    await expect(session.setCurrentStep(6)).resolves.toEqual({
      ok: false,
      error: 'Choose WEB or CD source media before continuing.'
    })
  })

  it('rejects a resume path outside app data', async () => {
    const session = newSession()
    await expect(session.resume('/elsewhere/upload-a/Album')).rejects.toThrow(
      'outside the current Gravlax workspace'
    )
  })
})
