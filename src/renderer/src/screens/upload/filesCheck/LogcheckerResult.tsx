import { For, Show } from 'solid-js'
import type { FilesCheckSnapshot } from '@shared/types'
import {
  hasLogResults,
  logHeadline,
  logScores,
  logTone
} from '@shared/upload/filesCheck'
import { FilesCheckResult } from './FilesCheckResult'

export function LogcheckerResult(props: { filesCheck: FilesCheckSnapshot }) {
  const tone = () => logTone(props.filesCheck)
  const scores = () => logScores(props.filesCheck)

  return (
    <Show when={hasLogResults(props.filesCheck)}>
      <FilesCheckResult
        tone={tone()}
        icon={tone() === 'success' ? 'check' : tone() === 'warning' ? 'alert-triangle' : 'info'}
      >
        <div class="files-check-headline">{logHeadline(props.filesCheck)}</div>
        <Show when={scores().length > 0}>
          <div class="files-check-scores">
            <For each={scores()}>
              {(entry) => (
                <div class="files-check-score-row">
                  <span
                    class={`files-check-score-value ${entry.score === 100 ? 'is-perfect' : 'is-imperfect'}`}
                  >
                    {entry.score}
                  </span>
                  <div class="files-check-score-meta">
                    <span class="files-check-score-tracker">{entry.tracker}</span>
                    <span class="files-check-score-file">{entry.fileName}</span>
                  </div>
                </div>
              )}
            </For>
          </div>
        </Show>
      </FilesCheckResult>
    </Show>
  )
}
