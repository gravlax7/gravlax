import { For, Show } from 'solid-js'
import type { FileChecksSnapshot } from '@shared/types'
import {
  hasUpconvertResults,
  upconvertFindings,
  upconvertHeadline,
  upconvertTone
} from '@shared/upload/fileChecks'
import { FileChecksResult } from './FileChecksResult'

export function UpconvertResult(props: { fileChecks: FileChecksSnapshot }) {
  const tone = () => upconvertTone(props.fileChecks)
  const findings = () => upconvertFindings(props.fileChecks)

  return (
    <Show when={hasUpconvertResults(props.fileChecks)}>
      <FileChecksResult
        tone={tone()}
        icon={tone() === 'success' ? 'check' : tone() === 'warning' ? 'alert-triangle' : 'info'}
      >
        <div class="file-checks-headline">{upconvertHeadline(props.fileChecks)}</div>
        <Show when={findings().length > 0}>
          <div class="file-checks-scores">
            <For each={findings()}>
              {(entry) => (
                <div class="file-checks-score-row">
                  <span class="file-checks-score-value is-imperfect">
                    {entry.wastedBits}/{entry.bitDepth}
                  </span>
                  <div class="file-checks-score-meta">
                    <span class="file-checks-score-tracker">Wasted bits</span>
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
