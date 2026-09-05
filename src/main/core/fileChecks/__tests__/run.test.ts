import { describe, expect, it, vi } from 'vitest'
import type { IntegritySummary, LogcheckerSummary } from '@shared/types'
import { runFileChecks, type FileChecksJobs } from '../run'

const passedIntegrity: IntegritySummary = {
  status: 'passed',
  checkedCount: 1,
  failures: [],
  repairedPaths: [],
  repairErrors: []
}

function jobs(overrides: Partial<FileChecksJobs> = {}): FileChecksJobs {
  return {
    checkStructure: vi.fn().mockResolvedValue({ ready: true, issues: [], approvedPaths: [], emptyDirectories: [], quarantined: [] }),
    checkIntegrity: vi.fn().mockResolvedValue(passedIntegrity),
    repairIntegrity: vi.fn().mockResolvedValue(passedIntegrity),
    checkMqa: vi.fn().mockResolvedValue({ checkedCount: 1, mqaPaths: [], errors: [] }),
    checkUpconvert: vi.fn().mockResolvedValue({ checkedCount: 0, results: [], errors: [] }),
    checkLogs: vi.fn().mockResolvedValue({ logFiles: [], checks: [] }),
    ...overrides
  }
}

describe('runFileChecks', () => {
  it('stops for unresolved folder rules before audio checks', async () => {
    const allJobs = jobs({
      checkStructure: vi.fn().mockResolvedValue({
        ready: false,
        issues: [{
          id: 'x',
          relativePath: 'notes.json',
          entryKind: 'file',
          rule: 'suspicious-extension',
          decision: 'pending',
          canKeep: true
        }],
        approvedPaths: [],
        emptyDirectories: [],
        quarantined: []
      })
    })

    const result = await runFileChecks({
      workspacePath: '/workspace',
      sourceMedia: 'CD',
      trackers: [],
      jobs: allJobs
    })

    expect(result.snapshot.structure.ready).toBe(false)
    expect(allJobs.checkIntegrity).not.toHaveBeenCalled()
    expect(allJobs.checkMqa).not.toHaveBeenCalled()
    expect(allJobs.checkLogs).not.toHaveBeenCalled()
  })

  it('stops after integrity failure and leaves later jobs untouched', async () => {
    const failedIntegrity: IntegritySummary = {
      ...passedIntegrity,
      status: 'failed',
      failures: [{ relativePath: 'bad.flac', message: 'MD5 mismatch' }]
    }
    const allJobs = jobs({
      checkIntegrity: vi.fn().mockResolvedValue(failedIntegrity)
    })

    const result = await runFileChecks({
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

  it('starts logs before integrity and keeps audio checks behind integrity', async () => {
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

    const result = await runFileChecks({
      workspacePath: '/workspace',
      sourceMedia: 'CD',
      trackers: [],
      jobs: allJobs,
      onIntegrityPassed: () => order.push('released')
    })

    expect(order).toEqual(['logchecker', 'integrity', 'released', 'mqa', 'upconvert'])
    expect(result.taskFailed).toBe(true)
    expect(result.snapshot.status).toBe('failed')
  })

  it.each(['audio', 'logs'] as const)('overlaps logs with audio when %s finishes first', async (first) => {
    const integrity = Promise.withResolvers<IntegritySummary>()
    const logs = Promise.withResolvers<LogcheckerSummary>()
    const started = Promise.withResolvers<void>()
    const audioDone = Promise.withResolvers<void>()
    const summary: LogcheckerSummary = { logFiles: ['rip.log'], checks: [] }
    const onIntegrityPassed = vi.fn()
    const onProgress = vi.fn()
    const allJobs = jobs({
      checkIntegrity: vi.fn(() => {
        started.resolve()
        return integrity.promise
      }),
      checkLogs: vi.fn(() => logs.promise),
      checkUpconvert: vi.fn(async () => {
        audioDone.resolve()
        return { checkedCount: 0, results: [], errors: [] }
      })
    })
    const completed = vi.fn()
    const run = runFileChecks({
      workspacePath: '/workspace',
      sourceMedia: 'CD',
      trackers: [],
      jobs: allJobs,
      onIntegrityPassed,
      onProgress
    }).then((result) => {
      completed()
      return result
    })

    await started.promise
    expect(allJobs.checkLogs).toHaveBeenCalledOnce()
    expect(allJobs.checkMqa).not.toHaveBeenCalled()
    if (first === 'audio') {
      integrity.resolve(passedIntegrity)
      await audioDone.promise
      expect(onIntegrityPassed).toHaveBeenCalledWith(passedIntegrity)
      expect(onProgress).toHaveBeenLastCalledWith(0, 1, 'Logchecker — Checking rip logs…')
      expect(completed).not.toHaveBeenCalled()
      logs.resolve(summary)
    } else {
      logs.resolve(summary)
      await logs.promise
      expect(completed).not.toHaveBeenCalled()
      expect(onProgress).not.toHaveBeenCalledWith(1, 1, 'Logchecker — Complete')
      integrity.resolve(passedIntegrity)
    }
    const result = await run
    expect(result.snapshot.logs).toEqual(summary)
    expect(result.snapshot.integrity.status).toBe('passed')
    expect(allJobs.checkMqa).toHaveBeenCalledOnce()
    expect(onProgress).toHaveBeenLastCalledWith(1, 1, 'Logchecker — Complete')
  })

  it('retains log results when integrity fails without running later audio checks', async () => {
    const summary: LogcheckerSummary = { logFiles: ['rip.log'], checks: [] }
    const allJobs = jobs({
      checkIntegrity: vi.fn().mockResolvedValue({ ...passedIntegrity, status: 'failed' }),
      checkLogs: vi.fn().mockResolvedValue(summary)
    })
    const result = await runFileChecks({
      workspacePath: '/workspace', sourceMedia: 'CD', trackers: [], jobs: allJobs
    })
    expect(result.snapshot.integrity.status).toBe('failed')
    expect(result.snapshot.logs).toEqual(summary)
    expect(allJobs.checkMqa).not.toHaveBeenCalled()
    expect(allJobs.checkUpconvert).not.toHaveBeenCalled()
    expect(result.detail).not.toContain('No FLAC files found for MQA')
  })

  it.each(['audio', 'logs', 'cancel'] as const)('aborts and drains both jobs on %s failure', async (failure) => {
    const controller = new AbortController()
    const started = Promise.withResolvers<void>()
    const failed = Promise.withResolvers<never>()
    const aborted = Promise.withResolvers<void>()
    const drained = Promise.withResolvers<void>()
    const error = new Error('check failed')
    const pending = async (signal?: AbortSignal) => {
      signal?.addEventListener('abort', () => aborted.resolve(), { once: true })
      await aborted.promise
      await drained.promise
      signal?.throwIfAborted()
    }
    const allJobs = jobs({
      checkIntegrity: vi.fn(async (_path, options) => {
        started.resolve()
        if (failure === 'audio') return failed.promise
        await pending(options?.signal)
        return passedIntegrity
      }),
      checkLogs: vi.fn(async (_path, options) => {
        if (failure === 'logs') return failed.promise
        await pending(options.signal)
        return { logFiles: [], checks: [] }
      })
    })
    const completed = vi.fn()
    const run = runFileChecks({
      workspacePath: '/workspace', sourceMedia: 'CD', trackers: [], jobs: allJobs,
      signal: controller.signal
    }).catch((error) => {
      completed()
      return error
    })
    await started.promise
    if (failure === 'cancel') controller.abort()
    else failed.reject(error)
    await aborted.promise
    expect(completed).not.toHaveBeenCalled()
    drained.resolve()
    const result = await run
    if (failure === 'cancel') expect(result.name).toBe('AbortError')
    else expect(result).toBe(error)
    expect(allJobs.checkMqa).not.toHaveBeenCalled()
    expect(allJobs.checkUpconvert).not.toHaveBeenCalled()
  })

  it('uses one repair pass only when automatic repair is enabled and allowed', async () => {
    const onRepairStarting = vi.fn(async () => undefined)
    const repairIntegrity = vi.fn<FileChecksJobs['repairIntegrity']>(
      async (_workspacePath, options) => {
        await options?.onRepairStarting?.()
        return passedIntegrity
      }
    )
    const allJobs = jobs({ repairIntegrity })

    await runFileChecks({
      workspacePath: '/workspace',
      sourceMedia: 'WEB',
      trackers: [],
      autoRepair: true,
      repairAllowed: true,
      onRepairStarting,
      jobs: allJobs
    })

    expect(allJobs.repairIntegrity).toHaveBeenCalledOnce()
    expect(allJobs.checkIntegrity).not.toHaveBeenCalled()
    expect(onRepairStarting).toHaveBeenCalledOnce()
  })
})
