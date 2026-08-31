import { describe, expect, it } from 'vitest'
import { runStartupTasks, type StartupTask } from '../runner'

describe('runStartupTasks', () => {
  it('runs tasks in order and continues after a best-effort failure', async () => {
    const calls: string[] = []
    const tasks: StartupTask<string[]>[] = [
      {
        id: 'first',
        failureMode: 'best-effort',
        run: (context) => {
          context.push('first')
          throw new Error('failed')
        }
      },
      {
        id: 'second',
        failureMode: 'fatal',
        run: (context) => {
          context.push('second')
        }
      }
    ]

    await expect(runStartupTasks(tasks, calls)).resolves.toBeUndefined()
    expect(calls).toEqual(['first', 'second'])
  })

  it('stops after a fatal failure', async () => {
    const calls: string[] = []
    const error = new Error('fatal')
    const tasks: StartupTask<string[]>[] = [
      {
        id: 'fatal',
        failureMode: 'fatal',
        run: (context) => {
          context.push('fatal')
          throw error
        }
      },
      {
        id: 'never',
        failureMode: 'best-effort',
        run: (context) => {
          context.push('never')
        }
      }
    ]

    await expect(runStartupTasks(tasks, calls)).rejects.toBe(error)
    expect(calls).toEqual(['fatal'])
  })
})
