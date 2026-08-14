import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  IpcEventChannel,
  IpcEventMap,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult
} from '../shared/ipc'

function invoke<C extends IpcInvokeChannel>(
  channel: C,
  ...args: IpcInvokeArgs<C>
): Promise<IpcInvokeResult<C>> {
  return ipcRenderer.invoke(channel, ...args) as Promise<IpcInvokeResult<C>>
}

function on<C extends IpcEventChannel>(
  channel: C,
  callback: (payload: IpcEventMap[C]) => void
): () => void {
  const listener = (_event: unknown, payload: IpcEventMap[C]): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  config: {
    load: () => invoke('config:load'),
    save: (cfg: IpcInvokeArgs<'config:save'>[0]) => invoke('config:save', cfg),
    resetSection: (section: IpcInvokeArgs<'config:resetSection'>[0]) =>
      invoke('config:resetSection', section),
    validate: (cfg: IpcInvokeArgs<'config:validate'>[0]) => invoke('config:validate', cfg),
    readSalmonImportSources: (options: IpcInvokeArgs<'config:readSalmonImportSources'>[0]) =>
      invoke('config:readSalmonImportSources', options)
  },
  stats: {
    load: () => invoke('stats:load'),
    onChange: (callback: (stats: IpcEventMap['stats:changed']) => void) => on('stats:changed', callback)
  },
  upload: {
    getState: () => invoke('upload:getState'),
    setCurrentStep: (index: number) => invoke('upload:setCurrentStep', index),
    setCurrentStepConfirmed: (index: number) => invoke('upload:setCurrentStepConfirmed', index),
    listStartEntries: () => invoke('upload:listStartEntries'),
    startNew: (path: string) => invoke('upload:startNew', path),
    resume: (workspacePath: string) => invoke('upload:resume', workspacePath),
    selectSourceMedia: (media: IpcInvokeArgs<'upload:selectSourceMedia'>[0]) =>
      invoke('upload:selectSourceMedia', media),
    setLossyMaster: (value: boolean) => invoke('upload:setLossyMaster', value),
    setLossyComment: (value: string) => invoke('upload:setLossyComment', value),
    resolveMetadataUrl: (url: string) => invoke('upload:resolveMetadataUrl', url),
    selectMetadataMatch: (selection: IpcInvokeArgs<'upload:selectMetadataMatch'>[0]) =>
      invoke('upload:selectMetadataMatch', selection),
    updateTagsProposed: (release: IpcInvokeArgs<'upload:updateTagsProposed'>[0]) =>
      invoke('upload:updateTagsProposed', release),
    setFilenameOverride: (id: string, value?: string) => invoke('upload:setFilenameOverride', id, value),
    setFolderNameOverride: (value?: string) => invoke('upload:setFolderNameOverride', value),
    setRenameReleaseFolder: (value: boolean) => invoke('upload:setRenameReleaseFolder', value),
    setStripEmbeddedCoverArt: (value: boolean) => invoke('upload:setStripEmbeddedCoverArt', value),
    applyTagsAndNames: (confirmed = false) => invoke('upload:applyTagsAndNames', confirmed),
    revertFiles: () => invoke('upload:revertFiles'),
    setTagsCursor: (cursor: number) => invoke('upload:setTagsCursor', cursor),
    setSpectralIds: (ids: number[]) => invoke('upload:setSpectralIds', ids),
    regenerateSpectrals: () => invoke('upload:regenerateSpectrals'),
    refreshFilesCheck: () => invoke('upload:refreshFilesCheck'),
    refreshMetadata: () => invoke('upload:refreshMetadata'),
    refreshTags: () => invoke('upload:refreshTags'),
    setTranscodeSelection: (optionIds: string[]) => invoke('upload:setTranscodeSelection', optionIds),
    setTranscodeEssentialOnly: (essentialOnly: boolean) =>
      invoke('upload:setTranscodeEssentialOnly', essentialOnly),
    refreshTranscode: () => invoke('upload:refreshTranscode'),
    runTranscode: () => invoke('upload:runTranscode'),
    ensureUploadReport: () => invoke('upload:ensureUploadReport'),
    updateUploadReport: (patch: IpcInvokeArgs<'upload:updateUploadReport'>[0]) =>
      invoke('upload:updateUploadReport', patch),
    searchTrackerGroups: (options?: IpcInvokeArgs<'upload:searchTrackerGroups'>[0]) =>
      invoke('upload:searchTrackerGroups', options),
    fetchTorrentGroup: (
      trackerId: IpcInvokeArgs<'upload:fetchTorrentGroup'>[0],
      groupId: number
    ) => invoke('upload:fetchTorrentGroup', trackerId, groupId),
    resolveTorrentGroupId: (
      trackerId: IpcInvokeArgs<'upload:resolveTorrentGroupId'>[0],
      torrentId: number
    ) => invoke('upload:resolveTorrentGroupId', trackerId, torrentId),
    submitUpload: () => invoke('upload:submitUpload'),
    startSeed: () => invoke('upload:startSeed'),
    saveTorrent: (submissionId: string) => invoke('upload:saveTorrent', submissionId),
    saveTorrents: () => invoke('upload:saveTorrents'),
    finish: () => invoke('upload:finish'),
    listSpectrals: () => invoke('upload:listSpectrals'),
    cancel: () => invoke('upload:cancel'),
    onState: (callback: (state: IpcEventMap['upload:state']) => void) => on('upload:state', callback),
    onNotify: (callback: (payload: IpcEventMap['upload:notify']) => void) => on('upload:notify', callback)
  },
  cache: {
    size: () => invoke('cache:size'),
    clear: () => invoke('cache:clear')
  },
  dialog: {
    pickDirectory: () => invoke('dialog:pickDirectory'),
    pickFile: (options?: IpcInvokeArgs<'dialog:pickFile'>[0]) => invoke('dialog:pickFile', options)
  },
  shell: {
    revealPath: (path: string) => invoke('shell:revealPath', path),
    openPath: (path: string) => invoke('shell:openPath', path),
    openExternal: (url: string) => invoke('shell:openExternal', url)
  },
  clipboard: {
    writeText: (text: string) => invoke('clipboard:writeText', text)
  },
  health: {
    refresh: () => invoke('health:refresh')
  },
  updates: {
    check: () => invoke('updates:check')
  },
  files: {
    getPathForFile: (file: File): string => webUtils.getPathForFile(file)
  },
  platform: process.platform as NodeJS.Platform
}

contextBridge.exposeInMainWorld('gravlax', api)

export type GravlaxAPI = typeof api
