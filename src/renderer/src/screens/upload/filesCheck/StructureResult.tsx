import { For, Show, createSignal } from 'solid-js'
import type { ReleaseStructureIssue, UploadFlowStateJSON } from '@shared/types'
import { Button } from '../../../ui'
import { FilesCheckResult } from './FilesCheckResult'

export function StructureResult(props: { state: UploadFlowStateJSON }) {
  const [busyIds, setBusyIds] = createSignal<string[]>([])
  const structure = () => props.state.filesCheck.structure
  const suspicious = () => structure().issues.filter((item) => item.rule === 'suspicious-extension')
  const blockers = () => structure().issues.filter((item) => item.rule !== 'suspicious-extension')
  const pendingSuspicious = () => suspicious().filter((item) => item.decision === 'pending')
  const busy = (id: string) => busyIds().includes(id)

  const resolve = async (
    items: Array<Pick<ReleaseStructureIssue, 'id'>>,
    action: 'keep' | 'quarantine'
  ): Promise<void> => {
    const ids = items.map((item) => item.id)
    if (ids.length === 0) return
    setBusyIds(ids)
    try {
      await window.gravlax.upload.resolveStructureItems(ids, action)
    } finally {
      setBusyIds([])
    }
  }

  const restore = async (id: string): Promise<void> => {
    setBusyIds([id])
    try {
      await window.gravlax.upload.resolveStructureItems([id], 'restore')
    } finally {
      setBusyIds([])
    }
  }

  return (
    <>
      <Show when={structure().issues.length === 0 && structure().ready}>
        <FilesCheckResult tone="success" icon="check">
          <div class="files-check-headline">Folder and file rules passed</div>
        </FilesCheckResult>
      </Show>

      <Show when={suspicious().length > 0}>
        <FilesCheckResult tone="warning" icon="alert-triangle">
          <div class="files-check-headline">Suspicious files</div>
          <div class="files-check-sub">
            These file types are not normally included in a release. Choose whether each file belongs in the upload.
          </div>
          <div class="files-check-structure-list">
            <For each={suspicious()}>
              {(item) => (
                <div class="files-check-structure-row">
                  <span class="mono files-check-structure-path">{item.relativePath}</span>
                  <Show
                    when={item.decision === 'pending'}
                    fallback={<span class="files-check-structure-kept">Kept</span>}
                  >
                    <div class="files-check-structure-actions">
                      <Button size="sm" disabled={busy(item.id)} onClick={() => void resolve([item], 'keep')}>Keep</Button>
                      <Button size="sm" variant="danger" disabled={busy(item.id)} onClick={() => void resolve([item], 'quarantine')}>Remove</Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <Show when={pendingSuspicious().length > 1}>
            <div class="files-check-structure-bulk">
              <Button size="sm" onClick={() => void resolve(pendingSuspicious(), 'keep')}>Keep all</Button>
              <Button size="sm" variant="danger" onClick={() => void resolve(pendingSuspicious(), 'quarantine')}>Remove all</Button>
            </div>
          </Show>
        </FilesCheckResult>
      </Show>

      <Show when={blockers().length > 0}>
        <FilesCheckResult tone="error" icon="alert-triangle">
          <div class="files-check-headline">Items must be removed</div>
          <div class="files-check-sub">Links, @eaDir, and non-FLAC audio cannot be part of this release.</div>
          <div class="files-check-structure-list">
            <For each={blockers()}>
              {(item) => (
                <div class="files-check-structure-row">
                  <span class="mono files-check-structure-path">{item.relativePath}</span>
                  <Button size="sm" variant="danger" disabled={busy(item.id)} onClick={() => void resolve([item], 'quarantine')}>Remove</Button>
                </div>
              )}
            </For>
          </div>
          <Show when={blockers().length > 1}>
            <Button size="sm" variant="danger" onClick={() => void resolve(blockers(), 'quarantine')}>Remove all</Button>
          </Show>
        </FilesCheckResult>
      </Show>

      <Show when={structure().emptyDirectories.length > 0}>
        <FilesCheckResult tone="info" icon="info">
          <div class="files-check-headline">Empty folders will be omitted</div>
          <div class="files-check-structure-list">
            <For each={structure().emptyDirectories}>
              {(path) => <span class="mono files-check-structure-path">{path}</span>}
            </For>
          </div>
        </FilesCheckResult>
      </Show>

      <Show when={structure().quarantined.length > 0}>
        <FilesCheckResult tone="info" icon="folder">
          <div class="files-check-headline">Removed from this upload</div>
          <div class="files-check-structure-list">
            <For each={structure().quarantined}>
              {(item) => (
                <div class="files-check-structure-row">
                  <span class="mono files-check-structure-path">{item.relativePath}</span>
                  <Button size="sm" disabled={busy(item.id)} onClick={() => void restore(item.id)}>Undo</Button>
                </div>
              )}
            </For>
          </div>
        </FilesCheckResult>
      </Show>
    </>
  )
}
