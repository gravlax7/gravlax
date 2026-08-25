import { Show } from 'solid-js'
import type { FileChecksSnapshot } from '@shared/types'
import { mqaHeadline, mqaTone } from '@shared/upload/fileChecks'
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
        </FileChecksResult>
      )}
    </Show>
  )
}
