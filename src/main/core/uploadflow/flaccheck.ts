import type { FlaccheckSummary } from '@shared/types'
import { emptyFlaccheckSummary } from '@main/core/tools/spectrals/flaccheck'
import type { State } from './state'

export function setFlaccheck(s: State, summary: FlaccheckSummary): State {
  return { ...s, flaccheck: restoreFlaccheck(summary) }
}

export function clearFlaccheck(s: State): State {
  return { ...s, flaccheck: emptyFlaccheckSummary() }
}

export function restoreFlaccheck(summary: FlaccheckSummary | undefined): FlaccheckSummary {
  if (!summary) return emptyFlaccheckSummary()
  return {
    status: summary.status ?? 'idle',
    checkedCount: summary.checkedCount ?? 0,
    files: (summary.files ?? []).map((f) => ({
      path: f.path,
      verdict: f.verdict,
      hiresVerdict: f.hiresVerdict ?? 'UNKNOWN'
    })),
    message: summary.message
  }
}
