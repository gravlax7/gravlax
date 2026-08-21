import { Show } from 'solid-js'
import type { FilesCheckSnapshot } from '@shared/types'
import { mqaHeadline, mqaTone } from '@shared/upload/filesCheck'
import { FilesCheckResult } from './FilesCheckResult'

export function MqaResult(props: { filesCheck: FilesCheckSnapshot }) {
  const tone = () => mqaTone(props.filesCheck)

  return (
    <Show when={props.filesCheck.integrity.status === 'passed' ? mqaHeadline(props.filesCheck) : null}>
      {(title) => (
        <FilesCheckResult
          tone={tone()}
          icon={tone() === 'success' ? 'check' : tone() === 'warning' ? 'alert-triangle' : 'info'}
        >
          <div class="files-check-headline">{title()}</div>
        </FilesCheckResult>
      )}
    </Show>
  )
}
