import type {
  FilesCheckSnapshot,
  IntegritySummary,
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

export type FilesCheckJob = keyof typeof JOB_LABELS

export interface RunFilesCheckOptions {
  workspacePath: string
  sourceMedia: SourceMedia
  trackers: Tracker[]
  signal?: AbortSignal
  tools?: ToolResolver
  repairRequested?: boolean
  autoRepair?: boolean
  repairAllowed?: boolean
  jobs?: Partial<FilesCheckJobs>
  onProgress?: (current: number, total: number, label: string) => void
  onRepairStarting?: () => void | Promise<void>
  onIntegrityPassed?: (integrity: IntegritySummary) => void
  approvedStructurePaths?: string[]
  quarantinedStructureEntries?: FilesCheckSnapshot['structure']['quarantined']
}

export interface FilesCheckRunResult {
  snapshot: FilesCheckSnapshot
  detail: string
  taskFailed: boolean
}

export interface FilesCheckJobs {
  checkStructure: typeof checkReleaseStructure
  checkIntegrity: typeof checkFLACIntegrityWorkspace
  repairIntegrity: typeof repairFLACIntegrityWorkspace
  checkMqa: typeof checkMQAWorkspace
  checkUpconvert: typeof checkUpconvertWorkspace
  checkLogs: typeof checkLogsWorkspace
}

export async function runFilesCheck(options: RunFilesCheckOptions): Promise<FilesCheckRunResult> {
  const {
    workspacePath,
    sourceMedia,
    signal,
    tools,
    onProgress
  } = options
  const progress = (job: FilesCheckJob) =>
    (current: number, total: number, label: string) =>
      onProgress?.(current, total, `${JOB_LABELS[job]} — ${label}`)
  const jobs: FilesCheckJobs = {
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
      detail: structureSummaryDetail(structure),
      taskFailed: false
    }
  }
  const shouldRepair = options.repairRequested || (options.autoRepair && options.repairAllowed)
  const integrity = shouldRepair
    ? await jobs.repairIntegrity(workspacePath, {
        signal,
        tools,
        onRepairStarting: options.onRepairStarting,
        onProgress: progress('integrity')
      })
    : await jobs.checkIntegrity(workspacePath, {
        signal,
        tools,
        onProgress: progress('integrity')
      })

  if (integrity.status !== 'passed') {
    return {
      snapshot: {
        status: 'ok',
        structure,
        integrity,
        mqa: { checkedCount: 0, mqaPaths: [], errors: [] },
        upconvert: { checkedCount: 0, results: [], errors: [] },
        logs: { logFiles: [], checks: [] }
      },
      detail: integritySummaryDetail(integrity),
      taskFailed: false
    }
  }

  options.onIntegrityPassed?.(integrity)
  const mqa = await jobs.checkMqa(workspacePath, {
    signal,
    tools,
    onProgress: progress('mqa')
  })
  const upconvert = await jobs.checkUpconvert(workspacePath, {
    signal,
    tools,
    onProgress: progress('upconvert')
  })
  onProgress?.(0, 1, `${JOB_LABELS.logchecker} — Checking rip logs…`)
  const logs = sourceMedia === 'CD'
    ? await jobs.checkLogs(workspacePath, {
        sourceMedia,
        trackers: options.trackers,
        signal
      })
    : { logFiles: [], checks: [] }
  onProgress?.(1, 1, `${JOB_LABELS.logchecker} — Complete`)
  const taskFailed = logs.checks.some((check) => Boolean(check.error))
  const snapshot: FilesCheckSnapshot = {
    status: taskFailed ? 'failed' : 'ok',
    structure,
    integrity,
    mqa,
    upconvert,
    logs
  }
  const detail = [
    structureSummaryDetail(structure),
    integritySummaryDetail(integrity),
    mqaSummaryDetail(mqa),
    upconvertSummaryDetail(upconvert),
    logcheckerSummaryDetail(logs)
  ].filter(Boolean).join('\n\n')

  return { snapshot, detail, taskFailed }
}
