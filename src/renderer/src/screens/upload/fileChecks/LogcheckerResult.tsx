import { For, Show } from 'solid-js'
import type { FileChecksSnapshot } from '@shared/types'
import {
  hasLogResults,
  logHeadline,
  logScores,
  logTone
} from '@shared/upload/fileChecks'
import { FileChecksResult } from './FileChecksResult'

export function LogcheckerResult(props: { fileChecks: FileChecksSnapshot }) {
  const tone = () => logTone(props.fileChecks)
  const scores = () => logScores(props.fileChecks)

  return (
    <Show when={hasLogResults(props.fileChecks)}>
      <FileChecksResult
        tone={tone()}
        icon={tone() === 'success' ? 'check' : tone() === 'warning' ? 'alert-triangle' : 'info'}
      >
        <div class="file-checks-headline">{logHeadline(props.fileChecks)}</div>
        <Show when={scores().length > 0}>
          <div class="file-checks-scores">
            <For each={scores()}>
              {(entry) => (
                <div class="file-checks-score-row">
                  <span
                    class={`file-checks-score-value ${entry.score === 100 ? 'is-perfect' : 'is-imperfect'}`}
                  >
                    {entry.score}
                  </span>
                  <div class="file-checks-score-meta">
                    <span class="file-checks-score-tracker">{entry.tracker}</span>
                    <span class="file-checks-score-file">{entry.fileName}</span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </FileChecksResult>
    </Show>
  )
}
