import { Show } from 'solid-js'
import type { FilesCheckSnapshot } from '@shared/types'
import { mqaHeadline, mqaTone } from '@shared/upload/filesCheck'
import { Icon } from '../../../ui'

export function MqaResult(props: { filesCheck: FilesCheckSnapshot }) {
  const tone = () => mqaTone(props.filesCheck)

  return (
    <Show when={props.filesCheck.integrity.status === 'passed' ? mqaHeadline(props.filesCheck) : null}>
      {(title) => (
        <div class={`files-check-result files-check-result-${tone()}`}>
          <Icon name={tone() === 'success' ? 'check' : 'alert-triangle'} size={20} />
          <div class="files-check-result-body">
            <div class="files-check-headline">{title()}</div>
          </div>
        </div>
      )}
    </Show>
  )
}
