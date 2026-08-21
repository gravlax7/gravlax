import type { JSX } from 'solid-js'
import type { CheckTone } from '@shared/upload/filesCheck'
import { Card, Icon, type IconName } from '../../../ui'

export function FilesCheckResult(props: {
  tone: CheckTone | 'error'
  icon: IconName
  children: JSX.Element
}) {
  return (
    <Card class={`files-check-result files-check-result-${props.tone}`}>
      <Icon name={props.icon} size={20} class="files-check-result-icon" />
      <div class="files-check-result-body">{props.children}</div>
    </Card>
  )
}
