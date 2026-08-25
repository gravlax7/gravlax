import type { MQASummary } from '@shared/types'
import { discoverFLACFiles } from '@main/core/tools/flacFiles'
import { checkMQA } from '../tools/diagnostics/mqa'
import { automaticToolResolver, type ToolResolver } from '@main/core/tools/binaries'

export type { MQASummary }

export async function checkMQAWorkspace(
  path: string,
  options: {
    signal?: AbortSignal
    check?: (path: string, signal?: AbortSignal) => Promise<boolean>
    onProgress?: (current: number, total: number, label: string) => void
    tools?: ToolResolver
  } = {}
): Promise<MQASummary> {
  if (!path) {
    throw new Error('workspace path is required')
  }
  const tools = options.tools ?? automaticToolResolver
  const check = options.check ?? ((filePath: string, signal?: AbortSignal) =>
    checkMQA(filePath, signal, tools))
  const files = await discoverFLACFiles(path)
  const summary: MQASummary = { checkedCount: files.length, mqaPaths: [], errors: [] }
  options.onProgress?.(0, files.length, files.length === 0 ? 'No FLAC files' : 'Checking for MQA…')
  for (let i = 0; i < files.length; i++) {
    options.signal?.throwIfAborted()
    const file = files[i]!
    options.onProgress?.(i, files.length, file.relativePath)
    try {
      const ok = await check(file.absolutePath, options.signal)
      if (ok) {
        summary.mqaPaths.push(file.relativePath)
      }
    } catch (err) {
      if ((err as Error).name === 'AbortError') throw err
      summary.errors.push({
        relativePath: file.relativePath,
        message: err instanceof Error ? err.message : String(err)
      })
    }
    options.onProgress?.(i + 1, files.length, file.relativePath)
  }
  return summary
}

export function mqaSummaryDetail(summary: MQASummary): string {
  if (summary.checkedCount === 0) {
    return 'No FLAC files found for MQA checks.'
  }
  let headline = `Checked ${summary.checkedCount} FLAC files. No MQA markers found.`
  if (summary.mqaPaths.length > 0) {
    headline = `Checked ${summary.checkedCount} FLAC files. MQA detected in ${summary.mqaPaths.length}.`
  }
  const lines = [headline]
  for (const path of summary.mqaPaths) {
    lines.push(`- ${path}`)
  }
  if (summary.errors.length > 0) {
    lines.push(`MQA check errors (${summary.errors.length}):`)
    for (const error of summary.errors) {
      lines.push(`- ${error.relativePath}: ${error.message}`)
    }
  }
  return lines.join('\n')
}
