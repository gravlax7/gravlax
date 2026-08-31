import type { ConfigService } from '@main/services/configService'
import { normalizeTrackerHosts } from '@shared/config/trackers'
import type { StartupTask } from './runner'

export interface StartupContext {
  appVersion: string
  userDataPath: string
  configService: ConfigService
}

export const STARTUP_TASKS: readonly StartupTask<StartupContext>[] = [
  {
    id: 'migrate-tracker-hosts',
    failureMode: 'best-effort',
    run: async ({ configService }) => {
      await configService.applyStartupUpdate(normalizeTrackerHosts)
    }
  }
]
