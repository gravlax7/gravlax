import type {
  FileChecksSnapshot,
  IntegritySummary,
  MQASummary,
  UpconvertSummary,
  SourceMedia
} from '@shared/types'
import type { ToolResolver } from '@main/core/tools/binaries'
import type { Tracker } from '@main/core/tools/trackers'
import {
  checkFLACIntegrityWorkspace,
  integritySummaryDetail,
  repairFLACIntegrityWorkspace
} from './integrity'
import { checkLogsWorkspace, logcheckerSummaryDetail } from './logchecker'
import { checkMQAWorkspace, mqaSummaryDetail } from './mqa'
import { checkUpconvertWorkspace, upconvertSummaryDetail } from './upconvert'
import { checkReleaseStructure, structureSummaryDetail } from './structure'

const JOB_LABELS = {
  structure: 'Folder rules',
  integrity: 'Integrity',
  mqa: 'MQA',
  upconvert: 'Upconvert',
  logchecker: 'Logchecker'
} as const

export type FileChecksJob = keyof typeof JOB_LABELS

export interface RunFileChecksOptions {
  workspacePath: string
  sourceMedia: SourceMedia
  trackers: Tracker[]
  signal?: AbortSignal
  tools?: ToolResolver
  repairRequested?: boolean
  autoRepair?: boolean
  repairAllowed?: boolean
  jobs?: Partial<FileChecksJobs>
  onProgress?: (current: number, total: number, label: string) => void
  onRepairStarting?: () => void | Promise<void>
  onIntegrityPassed?: (integrity: IntegritySummary) => void
  approvedStructurePaths?: string[]
  quarantinedStructureEntries?: FileChecksSnapshot['structure']['quarantined']
}

export interface FileChecksRunResult {
  snapshot: FileChecksSnapshot
  detail: string
  taskFailed: boolean
}

export interface FileChecksJobs {
  checkStructure: typeof checkReleaseStructure
  checkIntegrity: typeof checkFLACIntegrityWorkspace
  repairIntegrity: typeof repairFLACIntegrityWorkspace
  checkMqa: typeof checkMQAWorkspace
  checkUpconvert: typeof checkUpconvertWorkspace
  checkLogs: typeof checkLogsWorkspace
}

export async function runFileChecks(options: RunFileChecksOptions): Promise<FileChecksRunResult> {
  const {
    workspacePath,
    sourceMedia,
    signal,
    tools,
    onProgress
  } = options
  const progress = (job: FileChecksJob) =>
    (current: number, total: number, label: string) =>
      onProgress?.(current, total, `${JOB_LABELS[job]} — ${label}`)
  const jobs: FileChecksJobs = {
    checkStructure: checkReleaseStructure,
    checkIntegrity: checkFLACIntegrityWorkspace,
    repairIntegrity: repairFLACIntegrityWorkspace,
    checkMqa: checkMQAWorkspace,
    checkUpconvert: checkUpconvertWorkspace,
    checkLogs: checkLogsWorkspace,
    ...options.jobs
  }
  onProgress?.(0, 1, `${JOB_LABELS.structure} — Scanning release…`)
  const structure = await jobs.checkStructure(workspacePath, {
    expectedFormat: 'FLAC',
    approvedPaths: options.approvedStructurePaths,
    quarantined: options.quarantinedStructureEntries
  })
  onProgress?.(1, 1, `${JOB_LABELS.structure} — Complete`)
  if (!structure.ready) {
    return {
      snapshot: {
        status: 'ok',
        structure,
        integrity: {
          status: 'idle',
          checkedCount: 0,
          failures: [],
          repairedPaths: [],
          repairErrors: []
        },
        mqa: { checkedCount: 0, mqaPaths: [], errors: [] },
        upconvert: { checkedCount: 0, results: [], errors: [] },
        logs: { logFiles: [], checks: [] }
      },
      detail: structureSummaryDetail(structure, 'FLAC'),
      taskFailed: false
    }
  }
  // Logs only read .log files, so they can overlap FLAC checks and repairs.
  const controller = new AbortController()
  const checkSignal = signal
    ? AbortSignal.any([signal, controller.signal])
    : controller.signal
  checkSignal.throwIfAborted()
  let logsComplete = sourceMedia !== 'CD'
  const logCheck = (async () => {
    if (sourceMedia !== 'CD') return { logFiles: [], checks: [] }
    onProgress?.(0, 1, `${JOB_LABELS.logchecker} — Checking rip logs…`)
    const logs = await jobs.checkLogs(workspacePath, {
      sourceMedia,
      trackers: options.trackers,
      signal: checkSignal
    })
    logsComplete = true
    return logs
  })()
  const audioChecks = (async () => {
    const shouldRepair = options.repairRequested || (options.autoRepair && options.repairAllowed)
    const integrity = shouldRepair
      ? await jobs.repairIntegrity(workspacePath, {
          signal: checkSignal,
          tools,
          onRepairStarting: options.onRepairStarting,
          onProgress: progress('integrity')
        })
      : await jobs.checkIntegrity(workspacePath, {
          signal: checkSignal,
          tools,
          onProgress: progress('integrity')
        })

    checkSignal.throwIfAborted()
    let mqa: MQASummary = { checkedCount: 0, mqaPaths: [], errors: [] }
    let upconvert: UpconvertSummary = { checkedCount: 0, results: [], errors: [] }
    if (integrity.status === 'passed') {
      options.onIntegrityPassed?.(integrity)
      mqa = await jobs.checkMqa(workspacePath, {
        signal: checkSignal,
        tools,
        onProgress: progress('mqa')
      })
      checkSignal.throwIfAborted()
      upconvert = await jobs.checkUpconvert(workspacePath, {
        signal: checkSignal,
        tools,
        onProgress: progress('upconvert')
      })
    }
    checkSignal.throwIfAborted()
    if (!logsComplete) {
      onProgress?.(0, 1, `${JOB_LABELS.logchecker} — Checking rip logs…`)
    }
    return { integrity, mqa, upconvert }
  })()

  const [{ integrity, mqa, upconvert }, logs] = await Promise.all([audioChecks, logCheck])
    .catch(async (error) => {
      controller.abort()
      // Drain both jobs before callers can change the workspace or start another run.
      await Promise.allSettled([audioChecks, logCheck])
      throw error
    })
  checkSignal.throwIfAborted()
  if (sourceMedia === 'CD') {
    onProgress?.(1, 1, `${JOB_LABELS.logchecker} — Complete`)
  }
  const taskFailed = logs.checks.some((check) => Boolean(check.error))
  const snapshot: FileChecksSnapshot = {
    status: taskFailed ? 'failed' : 'ok',
    structure,
    integrity,
    mqa,
    upconvert,
    logs
  }
  const detail = [
    structureSummaryDetail(structure, 'FLAC'),
    integritySummaryDetail(integrity),
    integrity.status === 'passed' ? mqaSummaryDetail(mqa) : '',
    integrity.status === 'passed' ? upconvertSummaryDetail(upconvert) : '',
    logcheckerSummaryDetail(logs)
  ].filter(Boolean).join('\n\n')

  return { snapshot, detail, taskFailed }
}
