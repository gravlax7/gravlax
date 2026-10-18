import { For, Show } from 'solid-js'
import type { UploadFlowStateJSON } from '@shared/types'
import {
  UPLOAD_STEPS,
  canNavigateToStep,
  stepNodeStatus,
  transcodeStepHidden
} from '@shared/upload/stepGating'
import { Icon } from '../../ui'

export function Stepper(props: {
  state: UploadFlowStateJSON
  skipTranscode: boolean
  onNavigate: (index: number) => void
}) {
  const steps = () =>
    UPLOAD_STEPS.filter(
      (step) => step.id !== 'transcode' || !transcodeStepHidden(props.state, props.skipTranscode)
    )

  return (
    <nav class="ui-stepper" role="navigation" aria-label="Upload steps">
      <For each={steps()}>
        {(step, i) => {
          const status = () => stepNodeStatus(step.index, props.state)
          const canNav = () => canNavigateToStep(step.index, props.state)
          const isCurrent = () => step.index === props.state.currentStep
          return (
            <div class="ui-stepper-item">
              <button
                type="button"
                class={`ui-stepper-node ui-stepper-node-${status()}`}
                aria-current={isCurrent() ? 'step' : undefined}
                disabled={!canNav()}
                onClick={() => props.onNavigate(step.index)}
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
              <Show when={i() < steps().length - 1}>
                <div
                  class={`ui-stepper-connector ${
                    step.index < props.state.currentStep ? 'ui-stepper-connector-done' : ''
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
