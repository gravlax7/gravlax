import { For, Show } from 'solid-js'
import type { FilesCheckSnapshot } from '@shared/types'
import {
  hasLogResults,
  logHeadline,
  logScores,
  logTone
} from '@shared/upload/filesCheck'
import { Icon } from '../../../ui'

export function LogcheckerResult(props: { filesCheck: FilesCheckSnapshot }) {
  const tone = () => logTone(props.filesCheck)
  const scores = () => logScores(props.filesCheck)

  return (
    <Show when={hasLogResults(props.filesCheck)}>
      <div class={`files-check-result files-check-result-${tone()}`}>
        <Icon name={tone() === 'success' ? 'check' : 'alert-triangle'} size={20} />
        <div class="files-check-result-body">
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
        </div>
      </div>
    </Show>
  )
}
