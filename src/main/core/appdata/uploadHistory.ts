import { readFile, rename, writeFile } from 'node:fs/promises'
import { join, normalize, resolve } from 'node:path'
import type { UploadedReleaseRecord } from '@shared/types'

const UPLOAD_HISTORY_FILE = 'upload-history.json'

interface UploadHistoryFile {
  version: 1
  records: UploadedReleaseRecord[]
}

function historyPath(userDataPath: string): string {
  return join(userDataPath, UPLOAD_HISTORY_FILE)
}

function sourceKey(path: string): string {
  const key = normalize(resolve(path))
  return process.platform === 'win32' ? key.toLowerCase() : key
}

export async function readUploadHistory(userDataPath: string): Promise<UploadedReleaseRecord[]> {
  let payload: string
  try {
    payload = await readFile(historyPath(userDataPath), 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const parsed = JSON.parse(payload) as Partial<UploadHistoryFile>
  if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
    throw new Error('Upload history has an unknown format.')
  }
  return parsed.records.filter(
    (record): record is UploadedReleaseRecord =>
      record?.kind === 'uploaded' &&
      typeof record.sourcePath === 'string' &&
      typeof record.completedAt === 'number'
  )
}

export async function saveUploadedRelease(
  userDataPath: string,
  record: UploadedReleaseRecord
): Promise<void> {
  const records = await readUploadHistory(userDataPath)
  const key = sourceKey(record.sourcePath)
  const next = [record, ...records.filter((item) => sourceKey(item.sourcePath) !== key)]
  const target = historyPath(userDataPath)
  const temporary = `${target}.tmp`
  const payload = `${JSON.stringify({ version: 1, records: next } satisfies UploadHistoryFile, null, 2)}\n`
  await writeFile(temporary, payload)
  await rename(temporary, target)
}
