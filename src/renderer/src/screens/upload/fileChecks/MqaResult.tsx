import { For, Show } from 'solid-js'
import type { FileChecksSnapshot } from '@shared/types'
import { MQA_NOTE, mqaHeadline, mqaTone } from '@shared/upload/fileChecks'
import { FileChecksResult } from './FileChecksResult'

export function MqaResult(props: { fileChecks: FileChecksSnapshot }) {
  const tone = () => mqaTone(props.fileChecks)

  return (
    <Show when={props.fileChecks.integrity.status === 'passed' ? mqaHeadline(props.fileChecks) : null}>
      {(title) => (
        <FileChecksResult
          tone={tone()}
          icon={tone() === 'success' ? 'check' : tone() === 'warning' ? 'alert-triangle' : 'info'}
        >
          <div class="file-checks-headline">{title()}</div>
          <Show when={tone() === 'warning'}>
            <div class="file-checks-sub">
              MQA files cannot be transcoded, and the edition title must include “MQA”. {MQA_NOTE}
            </div>
            <div class="file-checks-integrity-list">
              <For each={props.fileChecks.mqa.mqaPaths}>
                {(path) => <span class="file-checks-score-file">{path}</span>}
              </For>
            </div>
          </Show>
        </FileChecksResult>
      )}
    </Show>
  )
}
