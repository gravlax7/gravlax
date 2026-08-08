import { describe, expect, it } from 'vitest'
import type { Config } from '@shared/types/config'

import { UploadSession } from '@main/services/uploadSession'

function newSession(): UploadSession {
  return new UploadSession({
    userDataPath: '/userdata',
    getConfig: () => ({}) as Config,
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
      'outside Gravlax app data'
    )
  })
})
