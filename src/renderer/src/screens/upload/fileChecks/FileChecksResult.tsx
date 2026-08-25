import type { JSX } from 'solid-js'
import type { CheckTone } from '@shared/upload/fileChecks'
import { Card, Icon, type IconName } from '../../../ui'

export function FileChecksResult(props: {
  tone: CheckTone | 'error'
  icon: IconName
  children: JSX.Element
}) {
  return (
    <Card class={`file-checks-result file-checks-result-${props.tone}`}>
      <Icon name={props.icon} size={20} class="file-checks-result-icon" />
      <div class="file-checks-result-body">{props.children}</div>
    </Card>
  )
}
