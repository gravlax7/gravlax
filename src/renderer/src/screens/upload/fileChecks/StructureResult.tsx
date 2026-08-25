import { For, Show, createSignal } from 'solid-js'
import type { ReleaseStructureIssue, UploadFlowStateJSON } from '@shared/types'
import { Button } from '../../../ui'
import { FileChecksResult } from './FileChecksResult'

export function StructureResult(props: { state: UploadFlowStateJSON }) {
  const [busyIds, setBusyIds] = createSignal<string[]>([])
  const structure = () => props.state.fileChecks.structure
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
        <FileChecksResult tone="success" icon="check">
          <div class="file-checks-headline">Folder and file rules passed</div>
        </FileChecksResult>
      </Show>

      <Show when={suspicious().length > 0}>
        <FileChecksResult tone="warning" icon="alert-triangle">
          <div class="file-checks-headline">Suspicious files</div>
          <div class="file-checks-sub">
            These file types are not normally included in a release. Choose whether each file belongs in the upload.
          </div>
          <div class="file-checks-structure-list">
            <For each={suspicious()}>
              {(item) => (
                <div class="file-checks-structure-row">
                  <span class="mono file-checks-structure-path">{item.relativePath}</span>
                  <Show
                    when={item.decision === 'pending'}
                    fallback={<span class="file-checks-structure-kept">Kept</span>}
                  >
                    <div class="file-checks-structure-actions">
                      <Button size="sm" disabled={busy(item.id)} onClick={() => void resolve([item], 'keep')}>Keep</Button>
                      <Button size="sm" variant="danger" disabled={busy(item.id)} onClick={() => void resolve([item], 'quarantine')}>Remove</Button>
                    </div>
                  </Show>
                </div>
              )}
            </For>
          </div>
          <Show when={pendingSuspicious().length > 1}>
            <div class="file-checks-structure-bulk">
              <Button size="sm" onClick={() => void resolve(pendingSuspicious(), 'keep')}>Keep all</Button>
              <Button size="sm" variant="danger" onClick={() => void resolve(pendingSuspicious(), 'quarantine')}>Remove all</Button>
            </div>
          </Show>
        </FileChecksResult>
      </Show>

      <Show when={blockers().length > 0}>
        <FileChecksResult tone="error" icon="alert-triangle">
          <div class="file-checks-headline">Items must be removed</div>
          <div class="file-checks-sub">Links, @eaDir, and non-FLAC audio cannot be part of this release.</div>
          <div class="file-checks-structure-list">
            <For each={blockers()}>
              {(item) => (
                <div class="file-checks-structure-row">
                  <span class="mono file-checks-structure-path">{item.relativePath}</span>
                  <Button size="sm" variant="danger" disabled={busy(item.id)} onClick={() => void resolve([item], 'quarantine')}>Remove</Button>
                </div>
              )}
            </For>
          </div>
          <Show when={blockers().length > 1}>
            <Button size="sm" variant="danger" onClick={() => void resolve(blockers(), 'quarantine')}>Remove all</Button>
          </Show>
        </FileChecksResult>
      </Show>

      <Show when={structure().emptyDirectories.length > 0}>
        <FileChecksResult tone="info" icon="info">
          <div class="file-checks-headline">Empty folders will be omitted</div>
          <div class="file-checks-structure-list">
            <For each={structure().emptyDirectories}>
              {(path) => <span class="mono file-checks-structure-path">{path}</span>}
            </For>
          </div>
        </FileChecksResult>
      </Show>

      <Show when={structure().quarantined.length > 0}>
        <FileChecksResult tone="info" icon="folder">
          <div class="file-checks-headline">Removed from this upload</div>
          <div class="file-checks-structure-list">
            <For each={structure().quarantined}>
              {(item) => (
                <div class="file-checks-structure-row">
                  <span class="mono file-checks-structure-path">{item.relativePath}</span>
                  <Button size="sm" disabled={busy(item.id)} onClick={() => void restore(item.id)}>Undo</Button>
                </div>
              )}
            </For>
          </div>
        </FileChecksResult>
      </Show>
    </>
  )
}
