import type {
  ReleaseAudioProfile,
  FileChecksSnapshot,
  IntegritySummary,
  LogcheckerSummary,
  MQASummary,
  RepairFlowProgress,
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

export function emptyFileChecks(): FileChecksSnapshot {
  return {
    status: 'idle',
    structure: {
      ready: false,
      issues: [],
      approvedPaths: [],
      emptyDirectories: [],
      quarantined: []
    },
    audio: emptyAudioProfile(),
    integrity: emptyIntegritySummary(),
    mqa: emptyMQASummary(),
    upconvert: emptyUpconvertSummary(),
    logs: { logFiles: [], checks: [] }
  }
}

export function emptyAudioProfile(): ReleaseAudioProfile {
  return {
    tracks: [],
    highestBitDepth: 0,
    highestSampleRate: 0,
    mixedBitDepth: false,
    mixedSampleRate: false
  }
}

export function setFileChecks(s: State, snapshot: FileChecksSnapshot): State {
  return { ...s, fileChecks: restoreFileChecks(snapshot) }
}

export function clearFileChecks(s: State): State {
  const empty = emptyFileChecks()
  return {
    ...s,
    fileChecks: {
      ...empty,
      structure: {
        ...empty.structure,
        approvedPaths: [...s.fileChecks.structure.approvedPaths],
        quarantined: s.fileChecks.structure.quarantined.map((item) => ({ ...item }))
      }
    }
  }
}

export function setFileChecksRunning(s: State): State {
  return { ...s, fileChecks: { ...emptyFileChecks(), status: 'running' } }
}

export function setFileChecksRepairProgress(s: State, repair: RepairFlowProgress): State {
  return { ...s, fileChecks: { ...s.fileChecks, repair: { ...repair } } }
}

/** Fills the gaps in a snapshot read back off disk, which may predate any field. */
export function restoreFileChecks(snapshot: FileChecksSnapshot | undefined): FileChecksSnapshot {
  if (!snapshot) return emptyFileChecks()
  const mqa = snapshot.mqa
  const integrity = snapshot.integrity
  const upconvert = snapshot.upconvert
  const logs = snapshot.logs
  const structure = snapshot.structure
  const audio = snapshot.audio
  return {
    status: snapshot.status ?? 'idle',
    structure: {
      ready: structure?.ready ?? false,
      issues: (structure?.issues ?? []).map((item) => ({ ...item })),
      approvedPaths: [...(structure?.approvedPaths ?? [])],
      emptyDirectories: [...(structure?.emptyDirectories ?? [])],
      quarantined: (structure?.quarantined ?? []).map((item) => ({ ...item }))
    },
    audio: {
      tracks: (audio?.tracks ?? []).map((track) => ({ ...track })),
      highestBitDepth: audio?.highestBitDepth ?? 0,
      highestSampleRate: audio?.highestSampleRate ?? 0,
      mixedBitDepth: audio?.mixedBitDepth ?? false,
      mixedSampleRate: audio?.mixedSampleRate ?? false
    },
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
    repair: snapshot.repair ? { ...snapshot.repair } : undefined,
    error: snapshot.error
  }
}
