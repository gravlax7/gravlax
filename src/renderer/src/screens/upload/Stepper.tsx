import { For, Show } from 'solid-js'
import type { UploadFlowStateJSON } from '@shared/types'
import {
  UPLOAD_STEPS,
  canNavigateToStep,
  stepNodeStatus
} from '@shared/upload/stepGating'
import { Icon } from '../../ui'

export function Stepper(props: {
  state: UploadFlowStateJSON
  onNavigate: (index: number) => void
}) {
  return (
    <nav class="ui-stepper" role="navigation" aria-label="Upload steps">
      <For each={UPLOAD_STEPS}>
        {(step, i) => {
          const status = () => stepNodeStatus(i(), props.state)
          const canNav = () => canNavigateToStep(i(), props.state)
          const isCurrent = () => i() === props.state.currentStep
          return (
            <div class="ui-stepper-item">
              <button
                type="button"
                class={`ui-stepper-node ui-stepper-node-${status()}`}
                aria-current={isCurrent() ? 'step' : undefined}
                disabled={!canNav()}
                onClick={() => props.onNavigate(i())}
              >
                <span class="ui-stepper-num">
                  <Show when={status() === 'done'}>
                    <Icon name="check" size={14} />
                  </Show>
                  <Show when={status() === 'error'}>
                    <Icon name="alert-triangle" size={14} />
                  </Show>
                  <Show when={status() !== 'done' && status() !== 'error'}>{i() + 1}</Show>
                </span>
                <span class="ui-stepper-label">{step.title}</span>
              </button>
              <Show when={i() < UPLOAD_STEPS.length - 1}>
                <div
                  class={`ui-stepper-connector ${
                    i() < props.state.currentStep ? 'ui-stepper-connector-done' : ''
                  }`}
                />
              </Show>
            </div>
          )
        }}
      </For>
    </nav>
  )
}
