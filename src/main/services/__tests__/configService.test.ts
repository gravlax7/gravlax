import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import { runStartupTasks } from '@main/core/startup/runner'
import { STARTUP_TASKS } from '@main/core/startup/tasks'
import { ConfigService } from '@main/services/configService'
import { normalizeTrackerHosts } from '@shared/config/trackers'

let root = ''
let userDataPath = ''

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-config-service-'))
  userDataPath = join(root, 'user-data')
  await mkdir(userDataPath)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function writeOldConfig(): Promise<void> {
  const cfg = defaultConfig()
  cfg.trackers.redacted.siteUrl = 'https://Site.Example/'
  cfg.trackers.redacted.announceUrl =
    'https://Announce.Example/old-private-passkey/announce'
  await writeFile(join(userDataPath, 'config.json'), `${JSON.stringify(cfg, null, 2)}\n`)
}

describe('ConfigService startup updates', () => {
  it('normalizes tracker hosts on a normal save', async () => {
    const service = new ConfigService(userDataPath)
    await service.ensureLoaded()
    const cfg = service.get()
    cfg.trackers.redacted.siteUrl = 'https://Site.Example/path'
    cfg.trackers.redacted.announceUrl = 'http://Announce.Example/old/announce'

    await expect(service.save(cfg)).resolves.toEqual({ ok: true })
    expect(service.get().trackers.redacted).toMatchObject({
      siteUrl: 'site.example',
      announceUrl: 'announce.example'
    })
  })

  it('migrates old tracker URLs at startup and skips a clean config', async () => {
    await writeOldConfig()
    const service = new ConfigService(userDataPath)
    await service.ensureLoaded()

    await runStartupTasks(STARTUP_TASKS, {
      appVersion: 'test',
      userDataPath,
      configService: service
    })

    expect(service.get().trackers.redacted).toMatchObject({
      siteUrl: 'site.example',
      announceUrl: 'announce.example'
    })
    const stored = JSON.parse(await readFile(join(userDataPath, 'config.json'), 'utf8'))
    expect(stored.trackers.redacted).toMatchObject({
      siteUrl: 'site.example',
      announceUrl: 'announce.example'
    })
    await expect(service.applyStartupUpdate(normalizeTrackerHosts)).resolves.toBe(false)
  })

  it('keeps the startup update in memory when persistence fails', async () => {
    await writeOldConfig()
    const service = new ConfigService(userDataPath)
    await service.ensureLoaded()
    await rm(userDataPath, { recursive: true })
    await writeFile(userDataPath, 'blocks the config directory')

    await expect(service.applyStartupUpdate(normalizeTrackerHosts)).rejects.toThrow()
    expect(service.get().trackers.redacted).toMatchObject({
      siteUrl: 'site.example',
      announceUrl: 'announce.example'
    })
  })
})
