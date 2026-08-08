import { readdir, stat } from 'node:fs/promises'
import { basename, join, normalize, resolve } from 'node:path'
import type {
  StepID,
  UploadStartEntries,
  UploadStartResumeEntry,
  UploadedReleaseRecord
} from '@shared/types'
import { expandPath } from '@main/core/config/paths'
import { listUploadWorkspaces } from '@main/core/appdata/workspace'
import { readUploadHistory } from '@main/core/appdata/uploadHistory'

function pathKey(path: string): string {
  const key = normalize(resolve(path))
  return process.platform === 'win32' ? key.toLowerCase() : key
}

function restoredStep(id: string | undefined): StepID {
  if (id === 'source' || id === undefined) return 'files-check'
  if (id === 'rules-check') return 'upload'
  if (
    id === 'files-check' ||
    id === 'spectrals' ||
    id === 'metadata' ||
    id === 'tags' ||
    id === 'transcode' ||
    id === 'upload' ||
    id === 'seed'
  ) return id
  return 'files-check'
}

async function exists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

export async function listUploadStartEntries(options: {
  userDataPath: string
  sourceDirectory: string
}): Promise<UploadStartEntries> {
  const sourceFolders: Array<{ path: string; updatedAt: number }> = []
  let sourceError = ''
  if (!options.sourceDirectory) {
    sourceError = 'No source directory configured. Set Directories > Source in Configuration.'
  } else {
    try {
      const root = expandPath(options.sourceDirectory).path
      const entries = await readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const path = join(root, entry.name)
        sourceFolders.push({ path, updatedAt: (await stat(path)).mtimeMs })
      }
    } catch {
      sourceError = 'No release folders found.'
    }
  }

  const [workspaces, history] = await Promise.all([
    listUploadWorkspaces(options.userDataPath),
    readUploadHistory(options.userDataPath)
  ])
  const historyByPath = new Map(history.map((item) => [pathKey(item.sourcePath), item]))
  const resumeByPath = new Map<string, UploadStartResumeEntry>()

  for (const workspace of workspaces) {
    const key = pathKey(workspace.sourcePath)
    const finished = historyByPath.get(key)
    // A retained workspace from the finished attempt belongs in Uploaded. A
    // newer workspace for the same source is a fresh resumable attempt.
    if (
      finished &&
      (workspace.snapshot?.seed?.phase === 'done' || workspace.updatedAt <= finished.completedAt)
    ) continue
    const candidate: UploadStartResumeEntry = {
      kind: 'resume',
      name: basename(workspace.sourcePath),
      sourcePath: workspace.sourcePath,
      workspacePath: workspace.workspacePath,
      currentStepID: restoredStep(workspace.snapshot?.currentStepID),
      updatedAt: workspace.updatedAt,
      sourceExists: await exists(workspace.sourcePath)
    }
    const current = resumeByPath.get(key)
    if (!current || candidate.updatedAt > current.updatedAt) resumeByPath.set(key, candidate)
  }

  const uploadedEntries: UploadedReleaseRecord[] = []
  for (const record of history) {
    if (resumeByPath.has(pathKey(record.sourcePath))) continue
    uploadedEntries.push({ ...record, sourceExists: await exists(record.sourcePath) })
  }

  const newEntries = sourceFolders
    .filter((folder) => {
      const key = pathKey(folder.path)
      return !resumeByPath.has(key) && !historyByPath.has(key)
    })
    .map((folder) => ({
      kind: 'new' as const,
      name: basename(folder.path),
      sourcePath: folder.path,
      updatedAt: folder.updatedAt
    }))

  return {
    newEntries: newEntries.sort((a, b) => b.updatedAt - a.updatedAt),
    resumeEntries: [...resumeByPath.values()].sort((a, b) => b.updatedAt - a.updatedAt),
    uploadedEntries: uploadedEntries.sort((a, b) => b.completedAt - a.completedAt),
    sourceError
  }
}
