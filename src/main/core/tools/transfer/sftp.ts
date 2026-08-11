import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client, type ConnectConfig, type SFTPWrapper } from 'ssh2'
import type { TransferConfig } from '@shared/types/config'
import { enumerateReleaseFiles } from '@main/core/tools/releaseFiles'
import type { TransferProgress, TransferProgressCallback } from './progress'

export type SftpProgress = TransferProgress
export type SftpProgressCallback = TransferProgressCallback

export interface SftpUploadFolderOptions {
  localFolder: string
  remoteFolder: string
  onProgress?: SftpProgressCallback
  signal?: AbortSignal
}

export async function testSftpConnection(cfg: TransferConfig): Promise<void> {
  const { client, sftp } = await connect(cfg)
  try {
    const remotePath = cfg.remotePath.trim()
    if (remotePath !== '') {
      await sftpStat(sftp, remotePath)
    }
  } finally {
    client.end()
  }
}

export async function uploadFolderViaSftp(
  cfg: TransferConfig,
  options: SftpUploadFolderOptions
): Promise<void> {
  throwIfAborted(options.signal)
  const files = await listFilesRecursive(options.localFolder)
  const bytesTotal = files.reduce((sum, f) => sum + f.size, 0)
  let bytesTransferred = 0
  let filesTransferred = 0

  const { client, sftp } = await connect(cfg)
  // Aborting between files isn't enough: a single fastPut of a large FLAC can
  // run for minutes. Tearing down the connection fails the in-flight transfer
  // immediately, and the throwIfAborted checks turn that into a clean abort.
  const onAbort = (): void => {
    client.end()
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    const remoteRoot = posixJoin(options.remoteFolder, path.basename(options.localFolder))
    const remoteDirs = new Set<string>([remoteRoot])
    for (const file of files) {
      const relative = path.relative(options.localFolder, file.path)
      remoteDirs.add(posixDirname(posixJoin(remoteRoot, toPosix(relative))))
    }
    const sortedDirs = [...remoteDirs].sort((a, b) => a.split('/').length - b.split('/').length)
    for (const dir of sortedDirs) {
      throwIfAborted(options.signal)
      await ensureRemoteDir(sftp, dir)
    }

    await mapPool(files, FILE_CONCURRENCY, async (file) => {
      throwIfAborted(options.signal)
      const relative = path.relative(options.localFolder, file.path)
      const remotePath = posixJoin(remoteRoot, toPosix(relative))
      await uploadFile(sftp, file.path, remotePath, (delta) => {
        bytesTransferred += delta
        options.onProgress?.({
          bytesTransferred: Math.min(bytesTransferred, bytesTotal),
          bytesTotal,
          filesTransferred,
          filesTotal: files.length,
          currentFile: relative
        })
      })
      filesTransferred += 1
      options.onProgress?.({
        bytesTransferred: Math.min(bytesTransferred, bytesTotal),
        bytesTotal,
        filesTransferred,
        filesTotal: files.length,
        currentFile: relative
      })
    })
    throwIfAborted(options.signal)
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    client.end()
  }
}

async function connect(cfg: TransferConfig): Promise<{ client: Client; sftp: SFTPWrapper }> {
  const connectConfig: ConnectConfig = {
    host: cfg.host.trim(),
    port: cfg.port || 22,
    username: cfg.username.trim(),
    readyTimeout: 15_000
  }
  if (cfg.password) connectConfig.password = cfg.password
  if (cfg.privateKeyPath.trim() !== '') {
    connectConfig.privateKey = await readFile(cfg.privateKeyPath.trim())
  }

  const client = new Client()
  try {
    await new Promise<void>((resolve, reject) => {
      client
        .on('ready', () => resolve())
        .on('error', reject)
        .connect(connectConfig)
    })

    return {
      client,
      sftp: await new Promise<SFTPWrapper>((resolve, reject) => {
        client.sftp((err, sftpClient) => {
          if (err) reject(err)
          else resolve(sftpClient)
        })
      })
    }
  } catch (err) {
    // The client is live from the moment connect() is called, and callers only
    // get a handle to end() once we return — so clean up anything we opened.
    client.end()
    throw err
  }
}

/**
 * Shared with torrent creation and the local seeding copy: the bytes sent here
 * have to be exactly the files the torrent lists.
 */
async function listFilesRecursive(
  dir: string
): Promise<Array<{ path: string; size: number }>> {
  const files = await enumerateReleaseFiles(dir)
  return files.map((file) => ({ path: file.absolutePath, size: file.size }))
}

function uploadFile(
  sftp: SFTPWrapper,
  localPath: string,
  remotePath: string,
  onChunk: (bytes: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    let previous = 0
    sftp.fastPut(
      localPath,
      remotePath,
      {
        step: (total) => {
          const delta = total - previous
          previous = total
          if (delta > 0) onChunk(delta)
        }
      },
      (err) => {
        if (err) reject(err)
        else resolve()
      }
    )
  })
}

function ensureRemoteDir(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  const parts = remoteDir.split('/').filter(Boolean)
  let current = remoteDir.startsWith('/') ? '/' : ''
  return (async () => {
    for (const part of parts) {
      current = current === '/' ? `/${part}` : current ? `${current}/${part}` : part
      try {
        await sftpStat(sftp, current)
      } catch {
        await sftpMkdir(sftp, current)
      }
    }
  })()
}

function sftpStat(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.stat(remotePath, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function sftpMkdir(sftp: SFTPWrapper, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remotePath, (err) => {
      if (!err) {
        resolve()
        return
      }
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'EEXIST' || String(code) === '4') resolve()
      else reject(err)
    })
  })
}

function posixJoin(...parts: string[]): string {
  return parts
    .filter((p) => p !== '')
    .map((p) => p.replace(/\\/g, '/'))
    .join('/')
    .replace(/\/+/g, '/')
}

function posixDirname(remotePath: string): string {
  const normalized = remotePath.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx <= 0) return normalized.startsWith('/') ? '/' : '.'
  return normalized.slice(0, idx)
}

function toPosix(relative: string): string {
  return relative.split(path.sep).join('/')
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('SFTP upload aborted')
}

const FILE_CONCURRENCY = 4

async function mapPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> {
  if (items.length === 0) return
  const limit = Math.max(1, Math.min(concurrency, items.length))
  let nextIndex = 0
  let firstError: unknown

  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (nextIndex < items.length) {
        if (firstError) return
        const index = nextIndex++
        const item = items[index]!
        try {
          await worker(item)
        } catch (err) {
          if (!firstError) firstError = err
          return
        }
      }
    })
  )

  if (firstError) throw firstError
}
