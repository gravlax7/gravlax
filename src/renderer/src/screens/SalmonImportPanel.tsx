import { For, Show, createMemo, createSignal } from 'solid-js'
import type { Config, NotifyPayload } from '@shared/types/config'
import type { ImportRow, SalmonImportPlan } from '@shared/config/salmonImport'
import { applySalmonImport, buildSalmonImportPlan } from '@shared/config/salmonImport'
import { sections } from '@shared/config/sections'
import { Modal } from '../components/Modal'
import { Badge, Button, Callout, EmptyState, Icon, IconButton } from '../ui'

const TOML_FILTERS = [
  { name: 'smoked-salmon config', extensions: ['toml'] },
  { name: 'All files', extensions: ['*'] }
]
const CONF_FILTERS = [
  { name: 'rclone config', extensions: ['conf'] },
  { name: 'All files', extensions: ['*'] }
]

export function SalmonImportPanel(props: {
  config: Config
  onApply: (next: Config) => void
  onNotify: (payload: NotifyPayload) => void
}) {
  const [tomlPath, setTomlPath] = createSignal('')
  const [plan, setPlan] = createSignal<SalmonImportPlan | undefined>()
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  const [revealed, setRevealed] = createSignal<Record<string, boolean>>({})
  const [loading, setLoading] = createSignal(false)
  const [confirming, setConfirming] = createSignal(false)
  const [error, setError] = createSignal('')

  const selectedRows = createMemo(() => (plan()?.rows ?? []).filter((row) => selected().has(row.id)))

  const load = async (paths: { tomlPath: string; rcloneConfPath?: string }): Promise<void> => {
    setLoading(true)
    setError('')
    try {
      const result = await window.gravlax.config.readSalmonImportSources(paths)
      if (!result.ok) {
        setPlan(undefined)
        setError(result.error)
        return
      }
      const next = buildSalmonImportPlan(result.input, props.config)
      setPlan(next)
      setSelected(new Set(next.rows.filter((row) => row.defaultSelected).map((row) => row.id)))
    } finally {
      setLoading(false)
    }
  }

  const pickToml = async (): Promise<void> => {
    const path = await window.gravlax.dialog.pickFile({ filters: TOML_FILTERS })
    if (!path) return
    setTomlPath(path)
    await load({ tomlPath: path })
  }

  const pickRcloneConf = async (): Promise<void> => {
    const path = await window.gravlax.dialog.pickFile({ filters: CONF_FILTERS })
    if (!path) return
    await load({ tomlPath: tomlPath(), rcloneConfPath: path })
  }

  const toggle = (id: string): void => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const apply = (): void => {
    const current = plan()
    if (!current) return
    props.onApply(applySalmonImport(props.config, current, selected()))
    const count = selectedRows().length
    props.onNotify({
      level: 'success',
      message: `Imported ${count} setting${count === 1 ? '' : 's'}. Save to keep them.`
    })
    setPlan(undefined)
    setTomlPath('')
  }

  return (
    <div class="salmon-import">
      <Callout tone="info">
        <Icon name="info" size={16} />
        <div>
          Reads a smoked-salmon <code>config.toml</code> and fills in the matching Gravlax settings.
          Nothing is written until you press Save. smoked-salmon keeps its config at{' '}
          <code>~/Library/Application Support/smoked-salmon/config.toml</code> on macOS and{' '}
          <code>~/.config/smoked-salmon/config.toml</code> on Linux.
        </div>
      </Callout>

      <div class="salmon-import-pick">
        <Button variant="secondary" onClick={() => void pickToml()} disabled={loading()}>
          <Icon name="folder" size={14} />
          {tomlPath() === '' ? 'Choose config.toml…' : 'Choose another file…'}
        </Button>
        <Show when={tomlPath() !== ''}>
          <span class="salmon-import-path">{tomlPath()}</span>
        </Show>
      </div>

      <Show when={error() !== ''}>
        <Callout tone="error">
          <Icon name="alert-triangle" size={16} />
          <div>{error()}</div>
        </Callout>
      </Show>

      <Show when={plan()}>
        {(current) => (
          <>
            <Show when={current().rcloneError}>
              {(message) => (
                <Callout tone="warning">
                  <Icon name="alert-triangle" size={16} />
                  <div>
                    <div>{message()}</div>
                    <Button
                      variant="secondary"
                      size="sm"
                      class="salmon-import-rclone-btn"
                      onClick={() => void pickRcloneConf()}
                    >
                      Locate rclone.conf…
                    </Button>
                  </div>
                </Callout>
              )}
            </Show>

            <Show
              when={current().rows.length > 0}
              fallback={
                <EmptyState
                  icon="check"
                  title="Nothing to import"
                  description="Every setting this file covers already matches what Gravlax has."
                />
              }
            >
              <div class="salmon-import-bar">
                <span>
                  {selectedRows().length} of {current().rows.length} selected
                </span>
                <div class="salmon-import-bar-actions">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set(current().rows.map((row) => row.id)))}
                  >
                    Select all
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                    Select none
                  </Button>
                  <Button
                    variant="primary"
                    onClick={() => setConfirming(true)}
                    disabled={selectedRows().length === 0}
                  >
                    Import selected
                  </Button>
                </div>
              </div>

              <For each={current().rows}>
                {(row) => (
                  <ImportRowView
                    row={row}
                    checked={selected().has(row.id)}
                    revealed={Boolean(revealed()[row.id])}
                    onToggle={() => toggle(row.id)}
                    onReveal={() => setRevealed((r) => ({ ...r, [row.id]: !r[row.id] }))}
                  />
                )}
              </For>
            </Show>

            <Show when={current().skipped.length > 0}>
              <details class="salmon-import-skipped">
                <summary>Not imported ({current().skipped.length})</summary>
                <For each={current().skipped}>
                  {(skip) => (
                    <div class="salmon-import-skip">
                      <code>{skip.sourceKey}</code>
                      <span>{skip.reason}</span>
                    </div>
                  )}
                </For>
              </details>
            </Show>
          </>
        )}
      </Show>

      <Show when={confirming()}>
        <Modal
          title={`Import ${selectedRows().length} setting${selectedRows().length === 1 ? '' : 's'}?`}
          description={overwriteSummary(selectedRows())}
          options={['Import', 'Cancel']}
          defaultIndex={0}
          onChoose={(index) => {
            setConfirming(false)
            if (index === 0) apply()
          }}
        />
      </Show>
    </div>
  )
}

function overwriteSummary(rows: ImportRow[]): string {
  const overwrites = rows.filter((row) => row.currentValue !== '').length
  const base =
    overwrites === 0
      ? 'All of these settings are currently empty.'
      : `${overwrites} of them replace a value you already have.`
  return `${base} Nothing is written to disk until you press Save.`
}

function ImportRowView(props: {
  row: ImportRow
  checked: boolean
  revealed: boolean
  onToggle: () => void
  onReveal: () => void
}) {
  const display = (value: string): string => {
    if (value === '') return '(empty)'
    if (props.row.sensitive && !props.revealed) return '•'.repeat(Math.min(value.length, 12))
    return value
  }

  return (
    <div class="salmon-import-row">
      <input
        type="checkbox"
        checked={props.checked}
        onChange={props.onToggle}
        aria-label={`Import ${props.row.label}`}
      />
      <div class="salmon-import-row-body">
        <div class="salmon-import-row-head">
          <span class="settings-field-label">{props.row.label}</span>
          <Badge tone="neutral">{sectionTitle(props.row.section)}</Badge>
          <Show when={props.row.origin === 'rclone'}>
            <Badge tone="info">rclone</Badge>
          </Show>
          <Show when={props.row.kind === 'approximate'}>
            <Badge tone="warning">approximate</Badge>
          </Show>
        </div>
        <div class="salmon-import-row-source">
          {props.row.sourceKey}
          <Icon name="chevron-right" size={12} />
          {props.row.section}.{props.row.field}
        </div>
        <div class="salmon-import-row-values">
          <span class="salmon-import-old">{display(props.row.currentValue)}</span>
          <Icon name="chevron-right" size={14} />
          <span class="salmon-import-new">{display(props.row.newValue)}</span>
          <Show when={props.row.sensitive}>
            <IconButton
              icon={props.revealed ? 'eye-off' : 'eye'}
              label={props.revealed ? 'Hide value' : 'Show value'}
              size="sm"
              onClick={props.onReveal}
            />
          </Show>
        </div>
        <Show when={props.row.note}>
          {(note) => <div class="salmon-import-row-note">{note()}</div>}
        </Show>
      </div>
    </div>
  )
}

function sectionTitle(id: string): string {
  return sections().find((section) => section.id === id)?.title ?? id
}
