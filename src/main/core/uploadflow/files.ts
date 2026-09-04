import type { FilesSnapshot, SourceRestoreUnavailableReason } from '@shared/types'
import type { State } from './state'

export function emptyFiles(): FilesSnapshot {
  return {
    original: { folderName: '', files: [] },
    apply: {
      phase: 'idle',
      onDiskModified: false,
      stripEmbeddedCoverArt: true,
      renameReleaseFolder: true,
      currentFolderName: '',
      files: [],
      payloadPaths: []
    }
  }
}

export function setFiles(s: State, files: FilesSnapshot): State {
  return {
    ...s,
    files: {
      original: {
        ...files.original,
        files: files.original.files.map((file) => ({ id: file.id, relativePath: file.relativePath }))
      },
      apply: {
        ...files.apply,
        onDiskModified: files.apply.onDiskModified ?? files.apply.phase === 'applied',
        files: files.apply.files.map((file) => ({ ...file })),
        payloadPaths: (files.apply.payloadPaths ?? []).map((item) => ({ ...item }))
      }
    }
  }
}

export function setEmbeddedCoverArtCount(s: State, count: number): State {
  return {
    ...s,
    files: {
      ...s.files,
      original: { ...s.files.original, embeddedCoverArtCount: count }
    }
  }
}

export function setSourceRestoreStatus(
  s: State,
  status: { available: true } | { available: false; reason: SourceRestoreUnavailableReason }
): State {
  return {
    ...s,
    files: {
      ...s.files,
      original: {
        ...s.files.original,
        restoreAvailable: status.available,
        restoreUnavailableReason: status.available ? undefined : status.reason
      }
    }
  }
}

export function markFilesDirty(s: State): State {
  if (s.files.apply.phase === 'applying' || s.files.apply.phase === 'restoring') return s
  return { ...s, files: { ...s.files, apply: { ...s.files.apply, phase: 'idle', grandfathered: false, error: undefined } } }
}

export function initializeFiles(
  s: State,
  folderName: string,
  relativePaths: string[],
  payload?: { files: string[]; directories: string[] }
): State {
  if (s.files.apply.files.length > 0) return s
  return {
    ...s,
    files: {
      ...s.files,
      original: {
        ...s.files.original,
        folderName,
        files: relativePaths.map((relativePath, index) => ({ id: `track-${index + 1}`, relativePath }))
      },
      apply: {
        ...s.files.apply,
        currentFolderName: folderName,
        files: relativePaths.map((currentPath, index) => ({ id: `track-${index + 1}`, currentPath })),
        payloadPaths: buildPayloadPaths(relativePaths, payload)
      }
    }
  }
}

export function reconcilePayloadPaths(
  s: State,
  payload: { files: string[]; directories: string[] }
): State {
  const existing = new Map((s.files.apply.payloadPaths ?? []).map((item) => [item.currentPath, item]))
  const tracks = new Map(s.files.apply.files.map((item) => [item.currentPath, item.id]))
  const next = [
    ...payload.directories.map((currentPath) => {
      const prior = existing.get(currentPath)
      return prior ?? {
        id: payloadId('directory', currentPath),
        kind: 'directory' as const,
        currentPath,
        originalPath: currentPath
      }
    }),
    ...payload.files.map((currentPath) => {
      const prior = existing.get(currentPath)
      return prior ?? {
        id: tracks.get(currentPath) ?? payloadId('file', currentPath),
        kind: 'file' as const,
        currentPath,
        originalPath: currentPath
      }
    })
  ]
  return {
    ...s,
    files: { ...s.files, apply: { ...s.files.apply, payloadPaths: next } }
  }
}

export function setPayloadNameOverride(s: State, id: string, value?: string): State {
  return {
    ...s,
    files: {
      ...s.files,
      apply: {
        ...s.files.apply,
        phase: s.files.apply.phase === 'applying' ? 'applying' : 'idle',
        error: undefined,
        grandfathered: false,
        payloadPaths: (s.files.apply.payloadPaths ?? []).map((item) =>
          item.id === id ? { ...item, nameOverride: value || undefined } : item
        )
      }
    }
  }
}

export function setFilenameOverride(s: State, id: string, value?: string): State {
  return {
    ...s,
    files: {
      ...s.files,
      apply: {
        ...s.files.apply,
        phase: s.files.apply.phase === 'applying' ? 'applying' : 'idle',
        error: undefined,
        grandfathered: false,
        files: s.files.apply.files.map((file) =>
          file.id === id ? { ...file, filenameOverride: value || undefined } : file
        )
      }
    }
  }
}

export function setFolderNameOverride(s: State, value?: string): State {
  return {
    ...s,
    files: {
      ...s.files,
      apply: { ...s.files.apply, phase: 'idle', grandfathered: false, error: undefined, folderNameOverride: value || undefined }
    }
  }
}

export function setRenameReleaseFolder(s: State, value: boolean): State {
  return {
    ...s,
    files: { ...s.files, apply: { ...s.files.apply, phase: 'idle', grandfathered: false, error: undefined, renameReleaseFolder: value } }
  }
}

export function setStripEmbeddedCoverArt(s: State, value: boolean): State {
  return {
    ...s,
    files: { ...s.files, apply: { ...s.files.apply, phase: 'idle', grandfathered: false, error: undefined, stripEmbeddedCoverArt: value } }
  }
}

export function beginFilesApply(s: State): State {
  return {
    ...s,
    files: {
      ...s.files,
      apply: { ...s.files.apply, phase: 'applying', error: undefined }
    }
  }
}

export function setFilesApplyProgress(
  s: State,
  current: number,
  total: number,
  label: string
): State {
  if (s.files.apply.phase !== 'applying' && s.files.apply.phase !== 'restoring') return s
  return {
    ...s,
    files: {
      ...s.files,
      apply: {
        ...s.files.apply,
        progressCurrent: current,
        progressTotal: total,
        progressLabel: label
      }
    }
  }
}

export function finishFilesApply(
  s: State,
  workspacePath: string,
  folderName: string,
  currentPaths: Array<{ id: string; currentPath: string }>,
  appliedHash: string,
  counts: { changedFileCount: number; strippedPictureCount: number },
  payloadPaths: Array<{ id: string; currentPath: string }>
): State {
  // Every planned file must have a rename result. A file left out keeps its
  // pre-rename path — which no longer exists on disk — and would silently
  // drop out of the file set the upload and seed stages copy.
  const resultIds = new Set(currentPaths.map((item) => item.id))
  for (const file of s.files.apply.files) {
    if (!resultIds.has(file.id)) {
      throw new Error(`finishFilesApply: no rename result for planned file "${file.id}"`)
    }
  }
  const pathMap = new Map(
    s.files.apply.files.map((file) => [
      file.currentPath,
      currentPaths.find((item) => item.id === file.id)?.currentPath ?? file.currentPath
    ])
  )
  const payloadPathMap = new Map(
    (s.files.apply.payloadPaths ?? []).map((item) => [
      item.currentPath,
      payloadPaths.find((next) => next.id === item.id)?.currentPath ?? item.currentPath
    ])
  )
  return {
    ...s,
    draft: { ...s.draft, workspacePath },
    files: {
      ...s.files,
      apply: {
        ...s.files.apply,
        phase: 'applied',
        onDiskModified: true,
        currentFolderName: folderName,
        files: s.files.apply.files.map((file) => ({
          ...file,
          currentPath: currentPaths.find((item) => item.id === file.id)?.currentPath ?? file.currentPath
        })),
        payloadPaths: (s.files.apply.payloadPaths ?? []).map((item) => ({
          ...item,
          currentPath: payloadPaths.find((next) => next.id === item.id)?.currentPath ?? item.currentPath
        })),
        appliedHash,
        ...counts,
        error: undefined,
        progressCurrent: undefined,
        progressTotal: undefined,
        progressLabel: undefined
      }
    },
    fileChecks: {
      ...s.fileChecks,
      structure: {
        ...s.fileChecks.structure,
        issues: s.fileChecks.structure.issues.map((item) => ({
          ...item,
          relativePath: payloadPathMap.get(item.relativePath) ?? item.relativePath
        })),
        approvedPaths: s.fileChecks.structure.approvedPaths.map(
          (path) => payloadPathMap.get(path) ?? path
        ),
        emptyDirectories: []
      },
      integrity: remapIntegrityPaths(s.fileChecks.integrity, pathMap),
      mqa: {
        ...s.fileChecks.mqa,
        mqaPaths: s.fileChecks.mqa.mqaPaths.map((path) => pathMap.get(path) ?? path),
        errors: s.fileChecks.mqa.errors.map((error) => ({ ...error, relativePath: pathMap.get(error.relativePath) ?? error.relativePath }))
      },
      upconvert: {
        ...s.fileChecks.upconvert,
        results: s.fileChecks.upconvert.results.map((result) => ({
          ...result,
          relativePath: pathMap.get(result.relativePath) ?? result.relativePath
        })),
        errors: s.fileChecks.upconvert.errors.map((error) => ({
          ...error,
          relativePath: pathMap.get(error.relativePath) ?? error.relativePath
        }))
      },
      logs: {
        ...s.fileChecks.logs,
        logFiles: s.fileChecks.logs.logFiles.map((path) => payloadPathMap.get(path) ?? path),
        checks: s.fileChecks.logs.checks.map((check) => ({
          ...check,
          relativePath: payloadPathMap.get(check.relativePath) ?? check.relativePath
        }))
      }
    }
  }
}

export function failFilesApply(s: State, error: string): State {
  return {
    ...s,
    files: {
      ...s.files,
      apply: {
        ...s.files.apply,
        phase: 'failed',
        error,
        progressCurrent: undefined,
        progressTotal: undefined,
        progressLabel: undefined
      }
    }
  }
}

export function beginFilesRestore(s: State): State {
  return {
    ...s,
    files: {
      ...s.files,
      apply: {
        ...s.files.apply,
        phase: 'restoring',
        error: undefined,
        progressCurrent: undefined,
        progressTotal: undefined,
        progressLabel: undefined
      }
    }
  }
}

export function finishFilesRestore(
  s: State,
  workspacePath: string,
  folderName: string,
  tracks: string[],
  payload?: { files: string[]; directories: string[] }
): State {
  return {
    ...s,
    draft: { ...s.draft, workspacePath },
    files: {
      original: {
        ...s.files.original,
        folderName,
        files: tracks.map((relativePath, index) => ({ id: `track-${index + 1}`, relativePath }))
      },
      apply: {
        ...emptyFiles().apply,
        stripEmbeddedCoverArt: s.files.apply.stripEmbeddedCoverArt,
        renameReleaseFolder: s.files.apply.renameReleaseFolder,
        currentFolderName: folderName,
        files: tracks.map((currentPath, index) => ({ id: `track-${index + 1}`, currentPath })),
        payloadPaths: buildPayloadPaths(tracks, payload),
        phase: s.files.apply.phase
      }
    }
  }
}

function buildPayloadPaths(
  tracks: string[],
  payload?: { files: string[]; directories: string[] }
): FilesSnapshot['apply']['payloadPaths'] {
  const trackIds = new Map(tracks.map((path, index) => [path, `track-${index + 1}`]))
  const files = payload?.files ?? tracks
  const directories = payload?.directories ?? []
  return [
    ...directories.map((currentPath) => ({
      id: payloadId('directory', currentPath),
      kind: 'directory' as const,
      currentPath,
      originalPath: currentPath
    })),
    ...files.map((currentPath) => ({
      id: trackIds.get(currentPath) ?? payloadId('file', currentPath),
      kind: 'file' as const,
      currentPath,
      originalPath: currentPath
    }))
  ]
}

function payloadId(kind: string, path: string): string {
  let hash = 2166136261
  const value = `${kind}:${path}`
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `payload-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function remapIntegrityPaths(
  integrity: State['fileChecks']['integrity'],
  pathMap: Map<string, string>
): State['fileChecks']['integrity'] {
  const remap = (path: string): string => pathMap.get(path) ?? path
  return {
    ...integrity,
    failures: integrity.failures.map((failure) => ({
      ...failure,
      relativePath: remap(failure.relativePath)
    })),
    repairedPaths: integrity.repairedPaths.map(remap),
    repairErrors: integrity.repairErrors.map((failure) => ({
      ...failure,
      relativePath: remap(failure.relativePath)
    }))
  }
}
