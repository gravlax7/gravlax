import { For, Show } from 'solid-js'
import type { FilesCheckSnapshot } from '@shared/types'
import {
  hasUpconvertResults,
  upconvertFindings,
  upconvertHeadline,
  upconvertTone
} from '@shared/upload/filesCheck'
import { Icon } from '../../../ui'

export function UpconvertResult(props: { filesCheck: FilesCheckSnapshot }) {
  const tone = () => upconvertTone(props.filesCheck)
  const findings = () => upconvertFindings(props.filesCheck)

  return (
    <Show when={hasUpconvertResults(props.filesCheck)}>
      <div class={`files-check-result files-check-result-${tone()}`}>
        <Icon
          name={tone() === 'success' ? 'check' : tone() === 'warning' ? 'alert-triangle' : 'info'}
          size={20}
        />
        <div class="files-check-result-body">
          <div class="files-check-headline">{upconvertHeadline(props.filesCheck)}</div>
          <Show when={findings().length > 0}>
            <div class="files-check-scores">
              <For each={findings()}>
                {(entry) => (
                  <div class="files-check-score-row">
                    <span class="files-check-score-value is-imperfect">
                      {entry.wastedBits}/{entry.bitDepth}
                    </span>
                    <div class="files-check-score-meta">
                      <span class="files-check-score-tracker">Wasted bits</span>
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
