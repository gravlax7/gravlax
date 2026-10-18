import { For } from 'solid-js'
import type { FileChecksSnapshot } from '@shared/types'
import { audioLimitFindings } from '@shared/upload/fileChecks'
import { FileChecksResult } from './FileChecksResult'

export function AudioLimitsResult(props: { fileChecks: FileChecksSnapshot }) {
  return (
    <For each={audioLimitFindings(props.fileChecks)}>
      {(finding) => (
        <FileChecksResult tone="error" icon="alert-triangle">
          <div class="file-checks-headline">{finding.headline}</div>
          <div class="file-checks-sub">{finding.detail}</div>
          <div class="file-checks-integrity-list">
            <For each={finding.tracks}>
              {(track) => <span class="file-checks-score-file">{track}</span>}
            </For>
          </div>
        </FileChecksResult>
      )}
    </For>
  )
}
