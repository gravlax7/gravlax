import { z } from 'zod'
import type { Config, NotifyPayload, SectionID, ValidationIssue } from './types/config'
import type { UploadStats } from './types/stats'
import type { SalmonImportInput } from './config/salmonImport'
import type { UpdateCheckResult } from './types/update'
import type {
  HealthResult,
  MetadataSelection,
  MetadataUrlResolution,
  Release,
  SourceMedia,
  TrackerGroupDetail,
  UploadFlowStateJSON,
  UploadStartEntries,
  UploadSnapshot,
  TorrentExportResult,
  UploadTrackerId
} from './types/upload'
import { WORKFLOW_STEPS } from './upload/workflow'

export type StepChangeResult =
  | { ok: true }
  | { ok: false; error: string; needsConfirmation?: boolean }

export interface IpcInvokeMap {
  'config:load': { args: []; result: Config }
  'config:save': { args: [Config]; result: { ok: true } | { ok: false; issues: ValidationIssue[] } }
  'config:resetSection': { args: [SectionID]; result: Config }
  'config:validate': { args: [Config]; result: ValidationIssue[] }
  'config:readSalmonImportSources': {
    args: [{ tomlPath: string; rcloneConfPath?: string }]
    result: { ok: true; input: SalmonImportInput } | { ok: false; error: string }
  }
  'stats:load': { args: []; result: UploadStats }
  'upload:getState': { args: []; result: UploadFlowStateJSON }
  'upload:setCurrentStep': { args: [number]; result: StepChangeResult }
  'upload:setCurrentStepConfirmed': { args: [number]; result: StepChangeResult }
  'upload:listStartEntries': { args: []; result: UploadStartEntries }
  'upload:startNew': { args: [string]; result: void }
  'upload:resume': { args: [string]; result: void }
  'upload:selectSourceMedia': { args: [SourceMedia]; result: void }
  'upload:setLossyMaster': { args: [boolean]; result: void }
  'upload:setLossyComment': { args: [string]; result: void }
  'upload:resolveMetadataUrl': { args: [string]; result: MetadataUrlResolution }
  'upload:selectMetadataMatch': { args: [MetadataSelection | null]; result: void }
  'upload:updateTagsProposed': { args: [Release]; result: void }
  'upload:setFilenameOverride': { args: [string, string?]; result: void }
  'upload:setFolderNameOverride': { args: [string?]; result: void }
  'upload:setRenameReleaseFolder': { args: [boolean]; result: void }
  'upload:setStripEmbeddedCoverArt': { args: [boolean]; result: void }
  'upload:applyTagsAndNames': { args: [boolean?]; result: StepChangeResult }
  'upload:revertFiles': { args: []; result: { ok: true } | { ok: false; error: string } }
  'upload:setTagsCursor': { args: [number]; result: void }
  'upload:setSpectralIds': { args: [number[]]; result: void }
  'upload:regenerateSpectrals': { args: []; result: void }
  'upload:refreshFilesCheck': { args: []; result: void }
  'upload:repairFlacIntegrity': { args: []; result: void }
  'upload:refreshMetadata': { args: []; result: void }
  'upload:refreshTags': { args: []; result: void }
  'upload:setTranscodeSelection': { args: [string[]]; result: void }
  'upload:setTranscodeEssentialOnly': { args: [boolean]; result: void }
  'upload:refreshTranscode': { args: []; result: void }
  'upload:runTranscode': { args: []; result: void }
  'upload:ensureUploadReport': { args: []; result: void }
  'upload:updateUploadReport': { args: [Partial<UploadSnapshot>]; result: void }
  'upload:searchTrackerGroups': { args: [{ force?: boolean }?]; result: void }
  'upload:fetchTorrentGroup': { args: [UploadTrackerId, number]; result: TrackerGroupDetail }
  'upload:resolveTorrentGroupId': { args: [UploadTrackerId, number]; result: number | null }
  'upload:submitUpload': { args: []; result: { ok: true } | { ok: false; error: string } }
  'upload:startSeed': { args: []; result: void }
  'upload:saveTorrent': { args: [string]; result: TorrentExportResult }
  'upload:saveTorrents': { args: []; result: TorrentExportResult }
  'upload:finish': { args: []; result: { ok: true } | { ok: false; error: string } }
  'upload:listSpectrals': { args: []; result: Array<{ full: string; zoom: string; index: number; filename: string }> }
  'upload:cancel': { args: []; result: void }
  'cache:size': { args: []; result: number }
  'cache:clear': { args: []; result: void }
  'dialog:pickDirectory': { args: []; result: string | null }
  'dialog:pickFile': { args: [{ filters?: Array<{ name: string; extensions: string[] }> }?]; result: string | null }
  'shell:revealPath': { args: [string]; result: void }
  'shell:openPath': { args: [string]; result: void }
  'shell:openExternal': { args: [string]; result: void }
  'clipboard:writeText': { args: [string]; result: void }
  'health:refresh': {
    args: [('startup' | 'settings-save' | 'manual')?]
    result: HealthResult
  }
  'diagnostics:report': { args: []; result: string }
  'diagnostics:revealLogs': { args: []; result: void }
  'updates:check': { args: []; result: UpdateCheckResult }
}

export interface IpcEventMap {
  'upload:state': UploadFlowStateJSON
  'upload:notify': NotifyPayload
  'stats:changed': UploadStats
  'health:updated': HealthResult
}

export type IpcInvokeChannel = keyof IpcInvokeMap
export type IpcInvokeArgs<C extends IpcInvokeChannel> = IpcInvokeMap[C]['args']
export type IpcInvokeResult<C extends IpcInvokeChannel> = IpcInvokeMap[C]['result']
export type IpcEventChannel = keyof IpcEventMap

const objectInput = <T>(): z.ZodType<T> =>
  z.object({}).passthrough().refine((value) => value !== null) as unknown as z.ZodType<T>

const noArgs = z.tuple([])
const trackerID = z.enum(['redacted', 'orpheus'])
const stepIndex = z.number().int().min(0).max(WORKFLOW_STEPS.length - 1)
const optionalOneArgument = <T>(schema: z.ZodType<T>): z.ZodType<[T?]> =>
  z.union([z.tuple([]), z.tuple([schema.optional()])]) as unknown as z.ZodType<[T?]>
const sectionID = z.enum([
  'appearance',
  'directories',
  'tools',
  'trackers',
  'metadataProviders',
  'imageHosts',
  'torrentClient',
  'transfer',
  'naming',
  'spectral',
  'cleanup',
  'workflow'
])
const trackerConfig = z.object({
  enabled: z.boolean(),
  siteUrl: z.string(),
  announceUrl: z.string(),
  apiKey: z.string(),
  sessionCookie: z.string(),
  coverImageHost: z.string()
})
const configInput: z.ZodType<Config> = z.object({
  appearance: z.object({
    theme: z.enum(['system', 'dark', 'midnight', 'fjord', 'ember', 'phosphor', 'light', 'inkwell'])
  }),
  directories: z.object({ source: z.string(), torrents: z.string(), seeding: z.string() }),
  tools: z.object({
    sox: z.string(),
    flac: z.string(),
    metaflac: z.string(),
    lame: z.string()
  }),
  trackers: z.object({ redacted: trackerConfig, orpheus: trackerConfig }),
  metadataProviders: z.object({
    musicBrainz: z.object({ enabled: z.boolean() }),
    deezer: z.object({ enabled: z.boolean() }),
    bandcamp: z.object({ enabled: z.boolean() }),
    requestTimeoutSeconds: z.number()
  }),
  imageHosts: z.object({
    thesungod: z.object({ enabled: z.boolean(), apiKey: z.string() }),
    imgbb: z.object({ enabled: z.boolean(), apiKey: z.string() }),
    catbox: z.object({ enabled: z.boolean() }),
    redacted: z.object({ enabled: z.boolean() })
  }),
  torrentClient: z.object({
    enabled: z.boolean(),
    url: z.string(),
    username: z.string(),
    password: z.string(),
    category: z.string(),
    useAutoTMM: z.boolean(),
    savePath: z.string(),
    startPaused: z.boolean()
  }),
  transfer: z.object({
    enabled: z.boolean(),
    host: z.string(),
    port: z.number(),
    username: z.string(),
    password: z.string(),
    privateKeyPath: z.string(),
    remotePath: z.string()
  }),
  naming: z.object({
    albumDescriptionTemplateId: z.string(),
    releaseFolderTemplate: z.string(),
    trackFileTemplate: z.string(),
    multiDiscFolderTemplate: z.string()
  }),
  spectral: z.object({
    imageHost: z.string(),
    defaultSpectralIds: z.string(),
    defaultSpectralIdsForLossyMasters: z.string()
  }),
  cleanup: z.object({
    archiveDirectory: z.string(),
    deleteOriginalFolder: z.boolean(),
    deleteTemporaryFiles: z.boolean(),
    deleteSpectralsAfterUpload: z.boolean()
  }),
  workflow: z.object({
    confirmBeforeWrites: z.boolean(),
    useUpcAsCatNo: z.boolean(),
    autoRepairFlacIntegrity: z.boolean()
  })
})

/** Runtime validation for values crossing Electron's process boundary. */
export const IPC_ARGUMENT_SCHEMAS: {
  [C in IpcInvokeChannel]: z.ZodType<IpcInvokeArgs<C>>
} = {
  'config:load': noArgs,
  'config:save': z.tuple([configInput]),
  'config:resetSection': z.tuple([sectionID]),
  'config:validate': z.tuple([configInput]),
  'config:readSalmonImportSources': z.tuple([
    z.object({ tomlPath: z.string().min(1), rcloneConfPath: z.string().optional() })
  ]),
  'stats:load': noArgs,
  'upload:getState': noArgs,
  'upload:setCurrentStep': z.tuple([stepIndex]),
  'upload:setCurrentStepConfirmed': z.tuple([stepIndex]),
  'upload:listStartEntries': noArgs,
  'upload:startNew': z.tuple([z.string().min(1)]),
  'upload:resume': z.tuple([z.string().min(1)]),
  'upload:selectSourceMedia': z.tuple([z.enum(['WEB', 'CD'])]),
  'upload:setLossyMaster': z.tuple([z.boolean()]),
  'upload:setLossyComment': z.tuple([z.string()]),
  'upload:resolveMetadataUrl': z.tuple([z.string().min(1)]),
  'upload:selectMetadataMatch': z.tuple([objectInput<MetadataSelection>().nullable()]),
  'upload:updateTagsProposed': z.tuple([objectInput<Release>()]),
  'upload:setFilenameOverride': z.tuple([z.string().min(1), z.string().optional()]),
  'upload:setFolderNameOverride': optionalOneArgument(z.string()),
  'upload:setRenameReleaseFolder': z.tuple([z.boolean()]),
  'upload:setStripEmbeddedCoverArt': z.tuple([z.boolean()]),
  'upload:applyTagsAndNames': optionalOneArgument(z.boolean()),
  'upload:revertFiles': noArgs,
  'upload:setTagsCursor': z.tuple([z.number().int().min(0)]),
  'upload:setSpectralIds': z.tuple([z.array(z.number().int().positive())]),
  'upload:regenerateSpectrals': noArgs,
  'upload:refreshFilesCheck': noArgs,
  'upload:repairFlacIntegrity': noArgs,
  'upload:refreshMetadata': noArgs,
  'upload:refreshTags': noArgs,
  'upload:setTranscodeSelection': z.tuple([z.array(z.string().min(1))]),
  'upload:setTranscodeEssentialOnly': z.tuple([z.boolean()]),
  'upload:refreshTranscode': noArgs,
  'upload:runTranscode': noArgs,
  'upload:ensureUploadReport': noArgs,
  'upload:updateUploadReport': z.tuple([objectInput<Partial<UploadSnapshot>>()]),
  'upload:searchTrackerGroups': optionalOneArgument(z.object({ force: z.boolean().optional() })),
  'upload:fetchTorrentGroup': z.tuple([trackerID, z.number().int().positive()]),
  'upload:resolveTorrentGroupId': z.tuple([trackerID, z.number().int().positive()]),
  'upload:submitUpload': noArgs,
  'upload:startSeed': noArgs,
  'upload:saveTorrent': z.tuple([z.string().min(1)]),
  'upload:saveTorrents': noArgs,
  'upload:finish': noArgs,
  'upload:listSpectrals': noArgs,
  'upload:cancel': noArgs,
  'cache:size': noArgs,
  'cache:clear': noArgs,
  'dialog:pickDirectory': noArgs,
  'dialog:pickFile': optionalOneArgument(z.object({ filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional() })),
  'shell:revealPath': z.tuple([z.string().min(1)]),
  'shell:openPath': z.tuple([z.string().min(1)]),
  'shell:openExternal': z.tuple([z.string().url()]),
  'clipboard:writeText': z.tuple([z.string().min(1)]),
  'health:refresh': optionalOneArgument(z.enum(['startup', 'settings-save', 'manual'])),
  'diagnostics:report': noArgs,
  'diagnostics:revealLogs': noArgs,
  'updates:check': noArgs
}

export function parseIpcArguments<C extends IpcInvokeChannel>(
  channel: C,
  args: unknown[]
): IpcInvokeArgs<C> {
  return IPC_ARGUMENT_SCHEMAS[channel].parse(args)
}
