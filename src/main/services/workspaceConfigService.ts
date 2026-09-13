import type { Config } from '@shared/types/config'
import type { ConfigSaveOptions, ConfigSaveResult } from '@shared/ipc'
import {
  prepareWorkspaceRoot,
  validateWorkspaceTarget,
  workspaceRoot,
  workspaceSize
} from '@main/core/appdata/workspace'
import { pathKey, pathsOverlap } from '@main/core/config/paths'
import type { ConfigService } from './configService'
import type { UploadSession } from './uploadSession'

export async function saveConfigWithWorkspaceChange(
  deps: {
    userDataPath: string
    configService: ConfigService
    uploadSession: UploadSession
  },
  cfg: Config,
  options?: ConfigSaveOptions
): Promise<ConfigSaveResult> {
  const prepared = deps.configService.prepare(cfg)
  if (prepared.issues.length > 0) {
    return { ok: false, reason: 'validation', issues: prepared.issues }
  }

  const currentDirectory = deps.configService.get().directories.workspace
  const nextDirectory = prepared.config.directories.workspace
  const from = workspaceRoot(deps.userDataPath, currentDirectory)
  const to = workspaceRoot(deps.userDataPath, nextDirectory)
  if (pathKey(from) === pathKey(to)) {
    return savePreparedConfig(deps.configService, prepared.config)
  }
  const targetIssue = pathsOverlap(from, to)
    ? 'New workspace folder must not contain or be inside the current workspace.'
    : await validateWorkspaceTarget(deps.userDataPath, nextDirectory)
  if (targetIssue) {
    return {
      ok: false,
      reason: 'validation',
      issues: [{ section: 'directories', field: 'workspace', message: targetIssue }]
    }
  }
  const confirmed = options?.confirmWorkspaceChange
  if (
    !confirmed ||
    pathKey(confirmed.from) !== pathKey(from) ||
    pathKey(confirmed.to) !== pathKey(to)
  ) {
    return {
      ok: false,
      reason: 'workspace-reset-required',
      change: { from, to, bytes: await workspaceSize(deps.userDataPath, currentDirectory) }
    }
  }

  await prepareWorkspaceRoot(deps.userDataPath, nextDirectory)
  await deps.uploadSession.clearCache({ removeRoot: true, notify: false })
  return savePreparedConfig(deps.configService, prepared.config)
}

async function savePreparedConfig(
  configService: ConfigService,
  cfg: Config
): Promise<ConfigSaveResult> {
  const result = await configService.save(cfg)
  return result.ok
    ? result
    : { ok: false, reason: 'validation', issues: result.issues }
}
