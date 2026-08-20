import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  checkLogsWorkspace,
  logcheckerHasIssues,
  logcheckerSummaryDetail
} from '../logchecker'
import type { Tracker } from '@main/core/tools/trackers'
import type { GazelleClient } from '@main/core/tools/trackers/gazelle'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gravlax-logchecker-'))
  dirs.push(dir)
  return dir
}

function mockTracker(
  id: 'redacted' | 'orpheus',
  name: string,
  checkLog: GazelleClient['checkLog']
): Tracker {
  return {
    id,
    name,
    client: { checkLog } as GazelleClient,
    healthcheck: async () => undefined,
    upload: async () => {
      throw new Error('upload not used in logchecker tests')
    },
    reportLossyMaster: async () => {
      throw new Error('reportLossyMaster not used in logchecker tests')
    }
  }
}

describe('checkLogsWorkspace', () => {
  it('skips when source media is not CD', async () => {
    const summary = await checkLogsWorkspace('/tmp', {
      sourceMedia: 'WEB',
      trackers: []
    })
    expect(summary.skippedReason).toMatch(/CD releases only/)
    expect(logcheckerSummaryDetail(summary)).toMatch(/CD releases only/)
  })

  it('skips when no trackers are enabled', async () => {
    const summary = await checkLogsWorkspace('/tmp', {
      sourceMedia: 'CD',
      trackers: []
    })
    expect(summary.skippedReason).toMatch(/No trackers enabled/)
  })

  it('runs logchecker for each log against each enabled tracker', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'rip.log'), 'Exact Audio Copy')
    const nested = join(dir, 'CD1')
    await mkdir(nested)
    await writeFile(join(nested, 'disc.log'), 'EAC log')

    const calls: Array<{ tracker: string; filename: string }> = []
    const trackers = [
      mockTracker('redacted', 'Redacted', async (input) => {
        const filename =
          input.log && 'filename' in input.log ? input.log.filename ?? '' : 'pastelog'
        calls.push({ tracker: 'redacted', filename })
        return { score: 100, issues: [], checksum: 'checksum_ok' }
      }),
      mockTracker('orpheus', 'Orpheus', async (input) => {
        const filename =
          input.log && 'filename' in input.log ? input.log.filename ?? '' : 'pastelog'
        calls.push({ tracker: 'orpheus', filename })
        return { score: 59, issues: ['Test and copy was not used (-20 points)'] }
      })
    ]

    const summary = await checkLogsWorkspace(dir, { sourceMedia: 'CD', trackers })
    expect(summary.logFiles).toEqual(['CD1/disc.log', 'rip.log'])
    expect(summary.checks).toHaveLength(4)
    expect(calls).toHaveLength(4)
    expect(logcheckerHasIssues(summary)).toBe(true)

    const detail = logcheckerSummaryDetail(summary)
    expect(detail).toContain('rip.log @ Redacted: score 100 (checksum_ok)')
    expect(detail).toContain('rip.log @ Orpheus: score 59')
    expect(detail).toContain('Test and copy was not used (-20 points)')
  })

  it('records per-tracker errors without aborting other checks', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'rip.log'), 'log')
    const trackers = [
      mockTracker('redacted', 'Redacted', async () => {
        throw new Error('auth failed')
      }),
      mockTracker('orpheus', 'Orpheus', async () => ({ score: 100, issues: [] }))
    ]
    const summary = await checkLogsWorkspace(dir, { sourceMedia: 'CD', trackers })
    expect(summary.checks).toHaveLength(2)
    expect(summary.checks[0]?.error).toBe('auth failed')
    expect(summary.checks[1]?.score).toBe(100)
    expect(logcheckerHasIssues(summary)).toBe(true)
  })
})
