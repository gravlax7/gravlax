import { ipcMain } from 'electron'
import type { IpcInvokeArgs, IpcInvokeChannel, IpcInvokeResult } from '@shared/ipc'
import { parseIpcArguments } from '@shared/ipc'
import type { ConfigService } from './services/configService'
import type { UploadSession } from './services/uploadSession'
import type { UploadStatsService } from './services/uploadStatsService'
import { runHealthcheck } from './services/healthcheck'
import { readSalmonImportSources } from './services/salmonImportService'
import type { ToolResolver } from './core/tools/binaries'

export interface IpcDeps {
  configService: ConfigService
  uploadStatsService: UploadStatsService
  uploadSession: UploadSession
  toolResolver: ToolResolver
  pickDirectory: () => Promise<string | null>
  pickFile: (options?: { filters?: Array<{ name: string; extensions: string[] }> }) => Promise<string | null>
  revealPath: (path: string) => Promise<void>
  openPath: (path: string) => Promise<void>
  openExternal: (url: string) => Promise<void>
  checkForUpdates: () => Promise<IpcInvokeResult<'updates:check'>>
}

type IpcHandler<C extends IpcInvokeChannel> = (
  ...args: IpcInvokeArgs<C>
) => IpcInvokeResult<C> | Promise<IpcInvokeResult<C>>

function handle<C extends IpcInvokeChannel>(channel: C, handler: IpcHandler<C>): void {
  ipcMain.handle(channel, async (_event, ...args: unknown[]) => {
    const parsed = parseIpcArguments(channel, args)
    return handler(...parsed)
  })
}

export function registerIpc(deps: IpcDeps): void {
  const { configService: config, uploadSession: upload, uploadStatsService: stats } = deps

  handle('config:load', () => config.ensureLoaded())
  handle('config:save', (cfg) => config.save(cfg))
  handle('config:resetSection', (section) => config.reset(section))
  handle('config:validate', (cfg) => config.validate(cfg))
  handle('config:readSalmonImportSources', (options) => readSalmonImportSources(options))
  handle('stats:load', () => stats.get())

  handle('upload:setCurrentStep', (index) => upload.setCurrentStep(index))
  handle('upload:setCurrentStepConfirmed', (index) => upload.setCurrentStep(index, true))
  handle('upload:listStartEntries', () => upload.listStartEntries())
  handle('upload:startNew', (path) => upload.startNew(path))
  handle('upload:resume', (workspacePath) => upload.resume(workspacePath))
  handle('upload:selectSourceMedia', (media) => upload.selectSourceMedia(media))
  handle('upload:setLossyMaster', (value) => upload.setLossyMaster(value))
  handle('upload:setLossyComment', (value) => upload.setLossyComment(value))
  handle('upload:resolveMetadataUrl', (url) => upload.resolveMetadataUrl(url))
  handle('upload:selectMetadataMatch', (selection) => upload.selectMetadataMatch(selection))
  handle('upload:updateTagsProposed', (release) => upload.updateTagsProposed(release))
  handle('upload:setFilenameOverride', (id, value) => upload.setFilenameOverride(id, value))
  handle('upload:setFolderNameOverride', (value) => upload.setFolderNameOverride(value))
  handle('upload:setRenameReleaseFolder', (value) => upload.setRenameReleaseFolder(value))
  handle('upload:setStripEmbeddedCoverArt', (value) => upload.setStripEmbeddedCoverArt(value))
  handle('upload:applyTagsAndNames', (confirmed = false) => upload.applyTagsAndNames(confirmed))
  handle('upload:revertFiles', () => upload.revertFiles())
  handle('upload:setTagsCursor', (cursor) => upload.setTagsCursor(cursor))
  handle('upload:setSpectralIds', (ids) => upload.setSpectralIds(ids))
  handle('upload:regenerateSpectrals', () => upload.regenerateSpectrals())
  handle('upload:refreshFilesCheck', () => upload.refreshFilesCheck())
  handle('upload:refreshMetadata', () => upload.refreshMetadata())
  handle('upload:refreshTags', () => upload.refreshTags())
  handle('upload:setTranscodeSelection', (optionIds) => upload.setTranscodeSelection(optionIds))
  handle('upload:setTranscodeEssentialOnly', (essentialOnly) => upload.setTranscodeEssentialOnly(essentialOnly))
  handle('upload:refreshTranscode', () => upload.refreshTranscode())
  handle('upload:runTranscode', () => upload.runTranscode())
  handle('upload:ensureUploadReport', () => upload.ensureUploadReport())
  handle('upload:updateUploadReport', (patch) => upload.updateUploadReport(patch))
  handle('upload:searchTrackerGroups', async (options) => upload.searchTrackerGroups(options ?? {}))
  handle('upload:fetchTorrentGroup', (trackerId, groupId) => upload.fetchTorrentGroup(trackerId, groupId))
  handle('upload:resolveTorrentGroupId', (trackerId, torrentId) => upload.resolveTorrentGroupId(trackerId, torrentId))
  handle('upload:submitUpload', () => upload.submitUpload())
  handle('upload:startSeed', () => upload.startSeed())
  handle('upload:finish', () => upload.finish())
  handle('upload:getState', () => upload.getState())
  handle('upload:listSpectrals', () => upload.listSpectrals())
  handle('upload:cancel', () => upload.cancelAll())

  handle('cache:size', () => upload.cacheSize())
  handle('cache:clear', () => upload.clearCache())
  handle('dialog:pickDirectory', () => deps.pickDirectory())
  handle('dialog:pickFile', (options) => deps.pickFile(options))
  handle('shell:revealPath', (path) => deps.revealPath(path))
  handle('shell:openPath', (path) => deps.openPath(path))
  handle('shell:openExternal', (url) => deps.openExternal(url))

  handle('health:refresh', () => runHealthcheck(config.get(), deps.toolResolver))
  handle('updates:check', () => deps.checkForUpdates())
}
