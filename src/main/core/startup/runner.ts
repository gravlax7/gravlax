import { diagnosticError, logDiagnostic } from '@main/core/diagnosticLog'

export type StartupFailureMode = 'fatal' | 'best-effort'

export interface StartupTask<Context> {
  id: string
  failureMode: StartupFailureMode
  run: (context: Context) => void | Promise<void>
}

export async function runStartupTasks<Context>(
  tasks: readonly StartupTask<Context>[],
  context: Context
): Promise<void> {
  for (const task of tasks) {
    logDiagnostic('startup_task_started', { taskId: task.id })
    try {
      await task.run(context)
      logDiagnostic('startup_task_complete', { taskId: task.id })
    } catch (error) {
      logDiagnostic('startup_task_failed', {
        taskId: task.id,
        failureMode: task.failureMode,
        ...diagnosticError(error)
      })
      if (task.failureMode === 'fatal') throw error
    }
  }
}
