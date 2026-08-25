import { For, Show } from 'solid-js'
import type { UploadFlowStateJSON } from '@shared/types'
import {
  flacIntegrityRepairAllowed,
  integrityHeadline,
  integrityTone
} from '@shared/upload/fileChecks'
import { Button } from '../../../ui'
import { FileChecksResult } from './FileChecksResult'

export function IntegrityResult(props: { state: UploadFlowStateJSON }) {
  const fileChecks = () => props.state.fileChecks
  const integrity = () => fileChecks().integrity
  const tone = () => integrityTone(fileChecks())
  const repairAllowed = () => flacIntegrityRepairAllowed(props.state)

  return (
    <Show when={integrity().status !== 'idle'}>
      <FileChecksResult tone={tone()} icon={tone() === 'success' ? 'check' : 'alert-triangle'}>
        <div class="file-checks-headline">{integrityHeadline(fileChecks())}</div>
        <Show when={integrity().failures.length > 0}>
          <div class="file-checks-integrity-list">
            <For each={integrity().failures}>
              {(failure) => (
                <div class="file-checks-integrity-item">
                  <span class="file-checks-score-file">{failure.relativePath}</span>
                  <span class="file-checks-sub">{failure.message}</span>
                </div>
              )}
            </For>
          </div>
          <Button
            size="sm"
            onClick={() => void window.gravlax.upload.repairFlacIntegrity()}
            disabled={!repairAllowed()}
          >
            Repair failed FLACs
          </Button>
          <Show when={!repairAllowed()}>
            <div class="file-checks-sub">
              Repair is unavailable after upload or seeding has started.
            </div>
          </Show>
        </Show>
        <Show when={integrity().repairErrors.length > 0}>
          <div class="file-checks-sub">
            {integrity().repairErrors.length} repair attempt{integrity().repairErrors.length === 1 ? '' : 's'} failed. See the log for details.
          </div>
        </Show>
      </FileChecksResult>
    </Show>
  )
}
