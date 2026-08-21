import { For, Show } from 'solid-js'
import type { UploadFlowStateJSON } from '@shared/types'
import {
  flacIntegrityRepairAllowed,
  integrityHeadline,
  integrityTone
} from '@shared/upload/filesCheck'
import { Button } from '../../../ui'
import { FilesCheckResult } from './FilesCheckResult'

export function IntegrityResult(props: { state: UploadFlowStateJSON }) {
  const filesCheck = () => props.state.filesCheck
  const integrity = () => filesCheck().integrity
  const tone = () => integrityTone(filesCheck())
  const repairAllowed = () => flacIntegrityRepairAllowed(props.state)

  return (
    <Show when={integrity().status !== 'idle'}>
      <FilesCheckResult tone={tone()} icon={tone() === 'success' ? 'check' : 'alert-triangle'}>
        <div class="files-check-headline">{integrityHeadline(filesCheck())}</div>
        <Show when={integrity().failures.length > 0}>
          <div class="files-check-integrity-list">
            <For each={integrity().failures}>
              {(failure) => (
                <div class="files-check-integrity-item">
                  <span class="files-check-score-file">{failure.relativePath}</span>
                  <span class="files-check-sub">{failure.message}</span>
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
            <div class="files-check-sub">
              Repair is unavailable after upload or seeding has started.
            </div>
          </Show>
        </Show>
        <Show when={integrity().repairErrors.length > 0}>
          <div class="files-check-sub">
            {integrity().repairErrors.length} repair attempt{integrity().repairErrors.length === 1 ? '' : 's'} failed. See the log for details.
          </div>
        </Show>
      </FilesCheckResult>
    </Show>
  )
}
