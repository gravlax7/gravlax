import type {
  FilesCheckSnapshot,
  IntegritySummary,
  LogcheckerSummary,
  MQASummary,
  UpconvertSummary
} from '@shared/types'
import type { State } from './state'

export function emptyMQASummary(): MQASummary {
  return { checkedCount: 0, mqaPaths: [], errors: [] }
}

export function emptyUpconvertSummary(): UpconvertSummary {
  return { checkedCount: 0, results: [], errors: [] }
}

export function emptyIntegritySummary(): IntegritySummary {
  return {
    status: 'idle',
    checkedCount: 0,
    failures: [],
    repairedPaths: [],
    repairErrors: []
  }
}

export function emptyFilesCheck(): FilesCheckSnapshot {
  return {
    status: 'idle',
    integrity: emptyIntegritySummary(),
    mqa: emptyMQASummary(),
    upconvert: emptyUpconvertSummary(),
    logs: { logFiles: [], checks: [] }
  }
}

export function setFilesCheck(s: State, snapshot: FilesCheckSnapshot): State {
  return { ...s, filesCheck: restoreFilesCheck(snapshot) }
}

export function clearFilesCheck(s: State): State {
  return { ...s, filesCheck: emptyFilesCheck() }
}

export function setFilesCheckRunning(s: State): State {
  return { ...s, filesCheck: { ...emptyFilesCheck(), status: 'running' } }
}

/** Fills the gaps in a snapshot read back off disk, which may predate any field. */
export function restoreFilesCheck(snapshot: FilesCheckSnapshot | undefined): FilesCheckSnapshot {
  if (!snapshot) return emptyFilesCheck()
  const mqa = snapshot.mqa
  const integrity = snapshot.integrity
  const upconvert = snapshot.upconvert
  const logs = snapshot.logs
  return {
    status: snapshot.status ?? 'idle',
    integrity: {
      status: integrity?.status ?? 'idle',
      checkedCount: integrity?.checkedCount ?? 0,
      failures: (integrity?.failures ?? []).map((failure) => ({ ...failure })),
      repairedPaths: [...(integrity?.repairedPaths ?? [])],
      repairErrors: (integrity?.repairErrors ?? []).map((failure) => ({ ...failure })),
      error: integrity?.error
    },
    mqa: {
      checkedCount: mqa?.checkedCount ?? 0,
      mqaPaths: mqa?.mqaPaths ?? [],
      errors: mqa?.errors ?? []
    },
    upconvert: {
      checkedCount: upconvert?.checkedCount ?? 0,
      results: (upconvert?.results ?? []).map((result) => ({
        relativePath: result.relativePath,
        bitDepth: result.bitDepth,
        wastedBits: result.wastedBits,
        isUpconverted: result.isUpconverted
      })),
      errors: upconvert?.errors ?? []
    },
    logs: {
      logFiles: logs?.logFiles ?? [],
      checks: (logs?.checks ?? []).map((check) => ({
        relativePath: check.relativePath,
        trackerId: check.trackerId,
        trackerName: check.trackerName,
        score: check.score,
        checksum: check.checksum,
        issues: check.issues ?? [],
        error: check.error
      })),
      skippedReason: logs?.skippedReason
    },
    error: snapshot.error
  }
}
