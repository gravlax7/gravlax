import { describe, expect, it, vi } from 'vitest'
import type { IntegritySummary } from '@shared/types'
import { runFilesCheck, type FilesCheckJobs } from '../run'

const passedIntegrity: IntegritySummary = {
  status: 'passed',
  checkedCount: 1,
  failures: [],
  repairedPaths: [],
  repairErrors: []
}

function jobs(overrides: Partial<FilesCheckJobs> = {}): FilesCheckJobs {
  return {
    checkIntegrity: vi.fn().mockResolvedValue(passedIntegrity),
    repairIntegrity: vi.fn().mockResolvedValue(passedIntegrity),
    checkMqa: vi.fn().mockResolvedValue({ checkedCount: 1, mqaPaths: [], errors: [] }),
    checkUpconvert: vi.fn().mockResolvedValue({ checkedCount: 0, results: [], errors: [] }),
    checkLogs: vi.fn().mockResolvedValue({ logFiles: [], checks: [] }),
    ...overrides
  }
}

describe('runFilesCheck', () => {
  it('stops after integrity failure and leaves later jobs untouched', async () => {
    const failedIntegrity: IntegritySummary = {
      ...passedIntegrity,
      status: 'failed',
      failures: [{ relativePath: 'bad.flac', message: 'MD5 mismatch' }]
    }
    const allJobs = jobs({
      checkIntegrity: vi.fn().mockResolvedValue(failedIntegrity)
    })

    const result = await runFilesCheck({
      workspacePath: '/workspace',
      sourceMedia: 'WEB',
      trackers: [],
      jobs: allJobs
    })

    expect(result.snapshot.integrity).toBe(failedIntegrity)
    expect(result.taskFailed).toBe(false)
    expect(allJobs.checkMqa).not.toHaveBeenCalled()
    expect(allJobs.checkUpconvert).not.toHaveBeenCalled()
    expect(allJobs.checkLogs).not.toHaveBeenCalled()
  })

  it('runs each later job only after integrity passes', async () => {
    const order: string[] = []
    const allJobs = jobs({
      checkIntegrity: vi.fn(async () => {
        order.push('integrity')
        return passedIntegrity
      }),
      checkMqa: vi.fn(async () => {
        order.push('mqa')
        return { checkedCount: 1, mqaPaths: [], errors: [] }
      }),
      checkUpconvert: vi.fn(async () => {
        order.push('upconvert')
        return { checkedCount: 0, results: [], errors: [] }
      }),
      checkLogs: vi.fn(async () => {
        order.push('logchecker')
        return {
          logFiles: ['rip.log'],
          checks: [{
            relativePath: 'rip.log',
            trackerId: 'tracker',
            trackerName: 'Tracker',
            issues: [],
            error: 'unavailable'
          }]
        }
      })
    })

    const result = await runFilesCheck({
      workspacePath: '/workspace',
      sourceMedia: 'CD',
      trackers: [],
      jobs: allJobs,
      onIntegrityPassed: () => order.push('released')
    })

    expect(order).toEqual(['integrity', 'released', 'mqa', 'upconvert', 'logchecker'])
    expect(result.taskFailed).toBe(true)
    expect(result.snapshot.status).toBe('failed')
  })

  it('uses one repair pass only when automatic repair is enabled and allowed', async () => {
    const allJobs = jobs()

    await runFilesCheck({
      workspacePath: '/workspace',
      sourceMedia: 'WEB',
      trackers: [],
      autoRepair: true,
      repairAllowed: true,
      jobs: allJobs
    })

    expect(allJobs.repairIntegrity).toHaveBeenCalledOnce()
    expect(allJobs.checkIntegrity).not.toHaveBeenCalled()
  })
})
