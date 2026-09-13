import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clearWorkspace, workspaceRoot } from '@main/core/appdata/workspace'
import { ConfigService } from '@main/services/configService'
import type { UploadSession } from '@main/services/uploadSession'
import { saveConfigWithWorkspaceChange } from '@main/services/workspaceConfigService'

let root = ''
let userDataPath = ''
let configService: ConfigService
let clearCache: ReturnType<typeof vi.fn>
let uploadSession: UploadSession

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'gravlax-workspace-setting-'))
  userDataPath = join(root, 'user-data')
  await mkdir(userDataPath)
  configService = new ConfigService(userDataPath)
  await configService.ensureLoaded()
  clearCache = vi.fn(async (options: { removeRoot?: boolean }) => {
    await clearWorkspace(
      userDataPath,
      configService.get().directories.workspace,
      options
    )
  })
  uploadSession = { clearCache } as unknown as UploadSession
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('workspace config save', () => {
  it('does not change or clear the workspace before confirmation', async () => {
    const oldRoot = workspaceRoot(userDataPath)
    await mkdir(oldRoot)
    await writeFile(join(oldRoot, 'saved-work.txt'), 'keep until confirmed')
    const custom = join(root, 'custom')
    await mkdir(custom)
    const next = configService.get()
    next.directories.workspace = custom

    const result = await saveConfigWithWorkspaceChange(
      { userDataPath, configService, uploadSession },
      next
    )

    expect(result).toEqual({
      ok: false,
      reason: 'workspace-reset-required',
      change: { from: oldRoot, to: custom, bytes: 20 }
    })
    expect(clearCache).not.toHaveBeenCalled()
    expect(configService.get().directories.workspace).toBe('')
    await expect(access(join(oldRoot, 'saved-work.txt'))).resolves.toBeUndefined()
    expect(await readdir(custom)).toEqual([])
  })

  it('clears the old root and marks the new root after matching confirmation', async () => {
    const oldRoot = workspaceRoot(userDataPath)
    await mkdir(oldRoot)
    await writeFile(join(oldRoot, 'saved-work.txt'), 'old')
    const custom = join(root, 'custom')
    await mkdir(custom)
    const next = configService.get()
    next.directories.workspace = custom

    const first = await saveConfigWithWorkspaceChange(
      { userDataPath, configService, uploadSession },
      next
    )
    if (first.ok || first.reason !== 'workspace-reset-required') throw new Error('confirmation missing')
    const result = await saveConfigWithWorkspaceChange(
      { userDataPath, configService, uploadSession },
      next,
      { confirmWorkspaceChange: { from: first.change.from, to: first.change.to } }
    )

    expect(result).toEqual({ ok: true })
    expect(clearCache).toHaveBeenCalledWith({ removeRoot: true, notify: false })
    await expect(access(oldRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(custom)).toEqual(['.gravlax-workspace'])
    expect(configService.get().directories.workspace).toBe(custom)
  })

  it('rejects a non-empty target without clearing the old root', async () => {
    const custom = join(root, 'custom')
    await mkdir(custom)
    await writeFile(join(custom, 'personal.txt'), 'keep')
    const next = configService.get()
    next.directories.workspace = custom

    const result = await saveConfigWithWorkspaceChange(
      { userDataPath, configService, uploadSession },
      next
    )

    expect(result).toEqual({
      ok: false,
      reason: 'validation',
      issues: [
        {
          section: 'directories',
          field: 'workspace',
          message: 'Choose a new or empty folder used only by Gravlax.'
        }
      ]
    })
    expect(clearCache).not.toHaveBeenCalled()
    await expect(access(join(custom, 'personal.txt'))).resolves.toBeUndefined()
  })

  it('rejects a target inside the old workspace', async () => {
    const oldRoot = workspaceRoot(userDataPath)
    const custom = join(oldRoot, 'custom')
    await mkdir(custom, { recursive: true })
    const next = configService.get()
    next.directories.workspace = custom

    const result = await saveConfigWithWorkspaceChange(
      { userDataPath, configService, uploadSession },
      next
    )

    expect(result).toEqual({
      ok: false,
      reason: 'validation',
      issues: [
        {
          section: 'directories',
          field: 'workspace',
          message: 'New workspace folder must not contain or be inside the current workspace.'
        }
      ]
    })
    expect(clearCache).not.toHaveBeenCalled()
  })
})
