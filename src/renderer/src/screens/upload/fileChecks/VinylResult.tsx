import { For, Show, createResource, createSignal } from 'solid-js'
import type { ReleaseAudioProfile, UploadFlowStateJSON, VinylLineage } from '@shared/types'
import { PASTED_LINEAGE_FILE } from '@shared/upload/vinyl'
import { Select } from '../../../components/Select'
import { Button, Callout, Card, Icon } from '../../../ui'
import { FileChecksResult } from './FileChecksResult'

export function LineageCard(props: { state: UploadFlowStateJSON }) {
  const lineage = () => props.state.draft.lineage
  const [files] = createResource(
    () => `${props.state.draft.workspacePath}\0${JSON.stringify(lineage() ?? null)}`,
    () => window.gravlax.upload.listLineageFiles()
  )
  const [showText, setShowText] = createSignal(false)
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal('')
  const [error, setError] = createSignal('')
  const [saving, setSaving] = createSignal(false)

  const chosenPath = () => {
    const current = lineage()
    if (current?.kind === 'file') return current.path
    if (current?.kind === 'pasted') return PASTED_LINEAGE_FILE
    return ''
  }
  const chosenText = () => {
    const current = lineage()
    if (current?.kind === 'pasted') return current.text
    return files()?.find((file) => file.path === chosenPath())?.text ?? ''
  }
  const otherFiles = () => (files() ?? []).map((file) => file.path).filter((path) => path !== chosenPath())

  const save = async (next: VinylLineage | null): Promise<boolean> => {
    setSaving(true)
    setError('')
    try {
      const result = await window.gravlax.upload.setLineage(next)
      if (!result.ok) setError(result.error)
      return result.ok
    } finally {
      setSaving(false)
    }
  }

  const openEditor = (): void => {
    const current = lineage()
    setDraft(current?.kind === 'pasted' ? current.text : '')
    setEditing(true)
  }

  return (
    <Card class="file-checks-lineage">
      <div class="file-checks-media-label">Lineage</div>
      <div class="file-checks-sub">
        {(() => {
          const current = lineage()
          if (!current) return 'Choose the lineage for this vinyl rip, or confirm uploading without one.'
          if (current.kind === 'file') return <>Using <span class="mono">{current.path}</span>. It goes in every torrent as it is.</>
          if (current.kind === 'pasted') return <>Using the pasted lineage, saved as <span class="mono">{PASTED_LINEAGE_FILE}</span> in every torrent.</>
          return 'Uploading without lineage.'
        })()}
      </div>

      <Show when={chosenText()}>
        <button
          type="button"
          class={`file-checks-log-toggle ${showText() ? 'is-open' : ''}`}
          aria-expanded={showText()}
          onClick={() => setShowText((v) => !v)}
        >
          <Icon name="chevron-down" size={14} />
          {showText() ? 'Hide text' : 'Show text'}
        </button>
        <Show when={showText()}>
          <pre class="file-checks-log mono">{chosenText()}</pre>
        </Show>
      </Show>

      <div class="file-checks-lineage-actions">
        <Show when={otherFiles().length > 0}>
          <Select
            value=""
            options={['', ...otherFiles()]}
            labelFor={(path) => path || (chosenPath() ? 'Use another file…' : 'Use a file…')}
            onChange={(path) => {
              if (path) void save({ kind: 'file', path })
            }}
          />
        </Show>
        <Show when={!editing()}>
          <Button size="sm" disabled={saving()} onClick={openEditor}>
            Paste or write the lineage
          </Button>
        </Show>
      </div>

      <Show when={editing()}>
        <div class="file-checks-sub">
          List the whole chain: turntable, cartridge, phono stage, converter or sound card,
          software, and any processing such as declicking. Say if you used a USB turntable.
        </div>
        <textarea
          class="mono upload-report-textarea"
          aria-label="Lineage"
          rows={8}
          value={draft()}
          onInput={(e) => setDraft(e.currentTarget.value)}
        />
        <div class="file-checks-lineage-actions">
          <Button
            size="sm"
            variant="primary"
            loading={saving()}
            disabled={!draft().trim()}
            onClick={async () => {
              if (await save({ kind: 'pasted', text: draft() })) setEditing(false)
            }}
          >
            Save lineage
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </div>
      </Show>

      <label class="file-checks-lineage-none">
        <input
          type="checkbox"
          checked={lineage()?.kind === 'none'}
          disabled={saving()}
          onChange={(e) => void save(e.currentTarget.checked ? { kind: 'none' } : null)}
        />
        <span>
          Upload without lineage
          <small class="file-checks-sub">
            A vinyl rip without lineage can be replaced by one with better documentation.
          </small>
        </span>
      </label>

      <Show when={error()}>
        <Callout tone="error">{error()}</Callout>
      </Show>
    </Card>
  )
}

export function VinylNotes(props: { audio: ReleaseAudioProfile }) {
  const notes = () => {
    const { highestBitDepth: depth, highestSampleRate: rate } = props.audio
    return [
      'Check that every side was ripped at its intended speed (33⅓, 45 or 78 rpm). Rips at the wrong speed get deleted.',
      'Upload the whole release: every record of a set goes in one torrent. If the package also has a CD or cassette, that is a separate upload.',
      depth === 24 && (rate === 44100 || rate === 48000)
        ? '24/44.1 and 24/48 vinyl rips are allowed only if they were ripped at that rate, not downsampled.'
        : '',
      depth === 16
        ? 'If this was made from a 24-bit rip, say so in the lineage, with the tool and settings used.'
        : ''
    ].filter(Boolean)
  }
  return (
    <FileChecksResult tone="info" icon="info">
      <div class="file-checks-headline">Check before uploading</div>
      <For each={notes()}>{(note) => <div class="file-checks-sub">{note}</div>}</For>
    </FileChecksResult>
  )
}
