import type { FilesSnapshot, OriginalFileSnapshot } from '@shared/types'
import type { State } from './state'

export function emptyFiles(): FilesSnapshot {
  return {
    original: { captured: false, coverCaptured: false, folderName: '', files: [] },
    apply: {
      phase: 'idle',
      onDiskModified: false,
      stripEmbeddedCoverArt: true,
      renameReleaseFolder: true,
      currentFolderName: '',
      files: []
    }
  }
}

export function setFiles(s: State, files: FilesSnapshot): State {
  const embeddedCoverArtCount = files.original.embeddedCoverArtCount ??
    (files.original.captured ? countOriginalEmbeddedCoverArt(files.original.files) : undefined)
  return {
    ...s,
    files: {
      original: {
        ...files.original,
        embeddedCoverArtCount,
        files: files.original.files.map((file) => ({ ...file }))
      },
      apply: {
        ...files.apply,
        onDiskModified: files.apply.onDiskModified ?? files.apply.phase === 'applied',
        files: files.apply.files.map((file) => ({ ...file }))
      }
    }
  }
}

export function setEmbeddedCoverArtCount(s: State, count: number): State {
  if (s.files.original.captured) return s
  return {
    ...s,
    files: {
      ...s.files,
      original: { ...s.files.original, embeddedCoverArtCount: count }
    }
  }
}

export function markFilesDirty(s: State): State {
  if (s.files.apply.phase === 'applying' || s.files.apply.phase === 'restoring') return s
  return { ...s, files: { ...s.files, apply: { ...s.files.apply, phase: 'idle', grandfathered: false, error: undefined } } }
}

export function initializeFiles(s: State, folderName: string, relativePaths: string[]): State {
  if (s.files.apply.files.length > 0) return s
  return {
    ...s,
    files: {
      ...s.files,
      original: { ...s.files.original, folderName },
      apply: {
        ...s.files.apply,
        currentFolderName: folderName,
        files: relativePaths.map((currentPath, index) => ({ id: `track-${index + 1}`, currentPath }))
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

export function beginFilesApply(s: State, original?: OriginalFileSnapshot[]): State {
  return {
    ...s,
    files: {
      original: original
        ? {
            ...s.files.original,
            captured: true,
            coverCaptured: true,
            embeddedCoverArtCount: s.files.original.embeddedCoverArtCount ??
              countOriginalEmbeddedCoverArt(original),
            files: original
          }
        : s.files.original,
      apply: { ...s.files.apply, phase: 'applying', error: undefined }
    }
  }
}

function countOriginalEmbeddedCoverArt(files: OriginalFileSnapshot[]): number {
  return files.reduce(
    (count, file) => count +
      (file.pictureBackups?.length ?? 0) +
      (file.legacyCoverBackups ?? []).filter((item) => item.key === 'COVERART').length,
    0
  )
}

export function finishFilesApply(
  s: State,
  workspacePath: string,
  folderName: string,
  currentPaths: Array<{ id: string; currentPath: string }>,
  appliedHash: string,
  counts: { changedFileCount: number; strippedPictureCount: number }
): State {
  const pathMap = new Map(
    s.files.apply.files.map((file) => [
      file.currentPath,
      currentPaths.find((item) => item.id === file.id)?.currentPath ?? file.currentPath
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
        appliedHash,
        ...counts,
        error: undefined
      }
    },
    flaccheck: {
      ...s.flaccheck,
      files: s.flaccheck.files.map((file) => ({ ...file, path: pathMap.get(file.path) ?? file.path }))
    },
    filesCheck: {
      ...s.filesCheck,
      mqa: {
        ...s.filesCheck.mqa,
        mqaPaths: s.filesCheck.mqa.mqaPaths.map((path) => pathMap.get(path) ?? path),
        errors: s.filesCheck.mqa.errors.map((error) => ({ ...error, relativePath: pathMap.get(error.relativePath) ?? error.relativePath }))
      }
    }
  }
}

export function failFilesApply(s: State, error: string): State {
  return { ...s, files: { ...s.files, apply: { ...s.files.apply, phase: 'failed', error } } }
}

export function beginFilesRestore(s: State): State {
  return { ...s, files: { ...s.files, apply: { ...s.files.apply, phase: 'restoring', error: undefined } } }
}

export function finishFilesRestore(s: State, workspacePath: string): State {
  const original = s.files.original
  const pathMap = new Map(
    s.files.apply.files.map((file) => [
      file.currentPath,
      original.files.find((item) => item.id === file.id)?.relativePath ?? file.currentPath
    ])
  )
  return {
    ...s,
    draft: { ...s.draft, workspacePath },
    files: {
      original,
      apply: {
        phase: 'idle',
        onDiskModified: false,
        stripEmbeddedCoverArt: false,
        renameReleaseFolder: false,
        currentFolderName: original.folderName,
        files: original.files.map((file) => ({ id: file.id, currentPath: file.relativePath }))
      }
    },
    flaccheck: {
      ...s.flaccheck,
      files: s.flaccheck.files.map((file) => ({ ...file, path: pathMap.get(file.path) ?? file.path }))
    },
    filesCheck: {
      ...s.filesCheck,
      mqa: {
        ...s.filesCheck.mqa,
        mqaPaths: s.filesCheck.mqa.mqaPaths.map((path) => pathMap.get(path) ?? path),
        errors: s.filesCheck.mqa.errors.map((error) => ({ ...error, relativePath: pathMap.get(error.relativePath) ?? error.relativePath }))
      }
    }
  }
}
