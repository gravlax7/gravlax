import { For, Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { Config, FieldMetadata, NotifyPayload, SectionID, ValidationIssue } from '@shared/types/config'
import { totalUploads, type UploadStats } from '@shared/types'
import {
  coverImageHostOptions,
  enabledSpectralImageHostOptions,
  sanitizeCoverImageHosts
} from '@shared/config/imageHosts'
import { sections } from '@shared/config/sections'
import { canEnableRedactedImageHost } from '@shared/config/trackers'
import {
  descriptionTemplateName,
  listDescriptionTemplateIds
} from '@shared/upload/templates'
import { formatByteSize } from '@shared/format'
import { Modal } from '../components/Modal'
import { SalmonImportPanel } from './SalmonImportPanel'
import { Select } from '../components/Select'
import { Toggle } from '../components/Toggle'
import { ProviderIcon, providerFromFieldName } from '../components/ProviderIcon'
import { TrackerIcon, trackerIdFromFieldName } from '../components/TrackerIcon'
import { hasPrimaryModifier } from '../keybinds'
import { Badge, Button, Callout, Divider, Icon, IconButton, Kbd, type IconName } from '../ui'

/** Not a config section — a pane in the same sidebar. Kept out of SectionID so
 *  Config indexing, resetSection and the IPC enum stay exhaustive. */
const IMPORT_PANE = {
  id: 'import' as const,
  title: 'Import',
  description: 'Bring settings across from a smoked-salmon config.toml.'
}
const WORKSPACE_PANE = {
  id: 'workspace' as const,
  title: 'Workspace',
  description: 'Manage local files Gravlax creates while it prepares uploads.'
}
const STATISTICS_PANE = {
  id: 'statistics' as const,
  title: 'Statistics',
  description: 'Your successful uploads by format and tracker.'
}
type PaneID =
  | SectionID
  | typeof IMPORT_PANE.id
  | typeof WORKSPACE_PANE.id
  | typeof STATISTICS_PANE.id

const SECTION_ICONS: Partial<Record<PaneID, IconName>> = {
  import: 'upload',
  workspace: 'trash-2',
  statistics: 'activity',
  appearance: 'sun',
  directories: 'folder',
  trackers: 'globe',
  metadataProviders: 'music',
  imageHosts: 'image',
  torrentClient: 'download',
  transfer: 'external-link',
  naming: 'settings',
  spectral: 'activity',
  cleanup: 'trash-2',
  workflow: 'settings'
}

export function SettingsScreen(props: {
  config: Config
  stats: UploadStats | null
  onChange: (cfg: Config) => void
  onBack: () => void
  onNotify: (payload: NotifyPayload) => void
}) {
  const [paneId, setPaneId] = createSignal<PaneID>(sections()[0]!.id)
  const [draft, setDraft] = createSignal(structuredClone(props.config))
  const [dirty, setDirty] = createSignal(false)
  const [issues, setIssues] = createSignal<ValidationIssue[]>([])
  const [leavePrompt, setLeavePrompt] = createSignal(false)
  const [resetPrompt, setResetPrompt] = createSignal(false)
  const [revealed, setRevealed] = createSignal<Record<string, boolean>>({})
  const [query, setQuery] = createSignal('')

  createEffect(() => {
    const theme = props.config.appearance.theme
    setDraft((d) => {
      if (d.appearance.theme === theme) return d
      return { ...d, appearance: { ...d.appearance, theme } }
    })
  })

  /** Undefined on the import pane, which has no fields to render. */
  const section = createMemo(() => sections().find((s) => s.id === paneId()))
  const paneTitle = (): string =>
    section()?.title ??
    (paneId() === 'workspace'
      ? WORKSPACE_PANE.title
      : paneId() === 'statistics'
        ? STATISTICS_PANE.title
        : IMPORT_PANE.title)
  const paneDescription = (): string | undefined =>
    section()?.description ??
    (paneId() === 'workspace'
      ? WORKSPACE_PANE.description
      : paneId() === 'statistics'
        ? STATISTICS_PANE.description
        : IMPORT_PANE.description)

  const panes = createMemo(() => {
    const q = query().trim().toLowerCase()
    const matchesPane = (
      pane: typeof IMPORT_PANE | typeof WORKSPACE_PANE | typeof STATISTICS_PANE,
      keywords: string
    ): boolean =>
      pane.title.toLowerCase().includes(q) ||
      pane.description.toLowerCase().includes(q) ||
      keywords.includes(q)
    const matchesImport = matchesPane(IMPORT_PANE, 'smoked-salmon toml')
    const matchesWorkspace = matchesPane(WORKSPACE_PANE, 'clear cache destructive upload files')
    const matchesStatistics = matchesPane(STATISTICS_PANE, 'uploads formats trackers')
    if (!q) return [...sections(), IMPORT_PANE, STATISTICS_PANE, WORKSPACE_PANE]
    const matched = sections().filter((s) => {
      if (s.title.toLowerCase().includes(q) || s.description?.toLowerCase().includes(q)) return true
      return s.fields.some(
        (f) =>
          f.label.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q) ||
          f.description?.toLowerCase().includes(q)
      )
    })
    return [
      ...matched,
      ...(matchesImport ? [IMPORT_PANE] : []),
      ...(matchesStatistics ? [STATISTICS_PANE] : []),
      ...(matchesWorkspace ? [WORKSPACE_PANE] : [])
    ]
  })

  const sectionIssues = createMemo(() => issues().filter((i) => i.section === paneId()))

  const markDirty = (next: Config): void => {
    setDraft(next)
    setDirty(true)
  }

  const save = async (): Promise<boolean> => {
    const result = await window.gravlax.config.save(draft())
    if (!result.ok) {
      setIssues(result.issues)
      const first = result.issues[0]
      if (first) {
        setPaneId(first.section)
        props.onNotify({
          level: 'error',
          message: `Save blocked: ${first.section}.${first.field} ${first.message}`
        })
      }
      return false
    }
    setIssues([])
    setDirty(false)
    props.onChange(draft())
    props.onNotify({ level: 'success', message: 'Settings saved.' })
    return true
  }

  const tryBack = async (): Promise<void> => {
    if (!dirty()) {
      props.onBack()
      return
    }
    setLeavePrompt(true)
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (leavePrompt() || resetPrompt()) return
      if (hasPrimaryModifier(event) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        event.stopPropagation()
        void save()
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        void tryBack()
      }
    }
    window.addEventListener('keydown', onKey)
    onCleanup(() => window.removeEventListener('keydown', onKey))
  })

  return (
    <div style={{ display: 'flex', flex: 1, 'min-height': 0 }}>
      <aside
        style={{
          width: '240px',
          'border-right': '1px solid var(--border)',
          'background-color': 'var(--bg-surface)',
          padding: 'var(--space-4) var(--space-2)',
          display: 'flex',
          'flex-direction': 'column',
          gap: 'var(--space-3)',
          'min-height': 0
        }}
      >
        <div style={{ 'padding': '0 8px', display: 'flex', 'align-items': 'center', gap: '8px' }}>
          <div style={{ 'font-weight': 700, flex: 1 }}>Settings</div>
          <Show when={dirty()}>
            <Badge tone="warning">Unsaved</Badge>
          </Show>
        </div>
        <div style={{ position: 'relative', padding: '0 4px' }}>
          <span
            style={{
              position: 'absolute',
              left: '14px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--fg-muted)',
              display: 'flex'
            }}
          >
            <Icon name="search" size={14} />
          </span>
          <input
            type="search"
            placeholder="Search settings…"
            value={query()}
            onInput={(e) => setQuery(e.currentTarget.value)}
            style={{
              width: '100%',
              padding: '7px 10px 7px 32px',
              'font-size': 'var(--text-sm)'
            }}
          />
        </div>
        <div style={{ flex: 1, overflow: 'auto' }}>
          <For each={panes()}>
            {(s) => (
              <button
                type="button"
                onClick={() => setPaneId(s.id)}
                style={{
                  display: 'flex',
                  width: '100%',
                  'align-items': 'center',
                  gap: '8px',
                  'text-align': 'left',
                  padding: '8px 10px',
                  border: '1px solid transparent',
                  'border-radius': 'var(--radius-sm)',
                  background: s.id === paneId() ? 'var(--accent-dim)' : 'transparent',
                  color: s.id === paneId() ? 'var(--accent)' : 'var(--fg-primary)',
                  'font-weight': s.id === paneId() ? 600 : 400
                }}
              >
                <Icon name={SECTION_ICONS[s.id] ?? 'settings'} size={14} />
                <span style={{ flex: 1 }}>{s.title}</span>
                <Show when={issues().some((i) => i.section === s.id)}>
                  <StatusWarn />
                </Show>
              </button>
            )}
          </For>
        </div>
      </aside>
      <section
        style={{
          flex: 1,
          display: 'flex',
          'flex-direction': 'column',
          'min-width': 0,
          'min-height': 0
        }}
      >
        <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
          <div class="content-frame">
            <div style={{ 'font-weight': 700, 'font-size': 'var(--text-xl)' }}>
              {paneTitle()}
            </div>
            <Show when={paneDescription()}>
              {(description) => (
                <div style={{ color: 'var(--fg-secondary)', 'font-size': 'var(--text-md)', 'margin-top': '4px' }}>
                  {description()}
                </div>
              )}
            </Show>
            <Show when={sectionIssues().length > 0}>
              <Callout tone="error" class="settings-validation-banner">
                <Icon name="alert-triangle" size={16} />
                <div>
                  <div style={{ 'font-weight': 600 }}>Fix {sectionIssues().length} validation issue{sectionIssues().length === 1 ? '' : 's'} before saving</div>
                  <ul style={{ margin: '6px 0 0', padding: '0 0 0 18px' }}>
                    <For each={sectionIssues()}>
                      {(issue) => (
                        <li style={{ 'font-size': 'var(--text-sm)' }}>
                          {issue.field}: {issue.message}
                        </li>
                      )}
                    </For>
                  </ul>
                </div>
              </Callout>
            </Show>
          </div>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--space-4)' }}>
          <div class="content-frame">
            <Show
              when={section()}
              fallback={
                <Show
                  when={paneId() === 'workspace'}
                  fallback={
                    <Show
                      when={paneId() === 'statistics'}
                      fallback={
                        <SalmonImportPanel
                          config={draft()}
                          onApply={(next) => markDirty(next)}
                          onNotify={props.onNotify}
                        />
                      }
                    >
                      <StatisticsPanel stats={props.stats} />
                    </Show>
                  }
                >
                  <WorkspacePanel />
                </Show>
              }
            >
              {(current) => (
                <For each={current().fields}>
                  {(field) => (
                    <Show
                      when={field.type === 'separator'}
                      fallback={
                        <FieldRow
                          field={field}
                          value={fieldValue(draft(), current().id, field)}
                          options={enumOptions(draft(), current().id, field)}
                          issue={issues().find((i) => i.section === current().id && i.field === field.name)}
                          revealed={Boolean(revealed()[`${current().id}.${field.name}`])}
                          disabled={
                            (current().id === 'imageHosts' &&
                              field.name === 'redacted.enabled' &&
                              !canEnableRedactedImageHost(draft()) &&
                              fieldValue(draft(), current().id, field) !== 'true') ||
                            // qBittorrent derives the location from the category
                            // under ATM. The stored value is left untouched so
                            // turning ATM back off restores what was typed.
                            (current().id === 'torrentClient' &&
                              field.name === 'savePath' &&
                              draft().torrentClient.useAutoTMM)
                          }
                          onReveal={() =>
                            setRevealed((r) => ({
                              ...r,
                              [`${current().id}.${field.name}`]: !r[`${current().id}.${field.name}`]
                            }))
                          }
                          onChange={async (value) => {
                            const next = await applyField(draft(), current().id, field, value)
                            markDirty(next)
                          }}
                          onPickPath={async () => {
                            const path =
                              field.type === 'file'
                                ? await window.gravlax.dialog.pickFile({
                                    filters: [
                                      { name: 'Private keys', extensions: ['pem', 'key', 'ppk', ''] },
                                      { name: 'All files', extensions: ['*'] }
                                    ]
                                  })
                                : await window.gravlax.dialog.pickDirectory()
                            if (path) {
                              const next = await applyField(draft(), current().id, field, path)
                              markDirty(next)
                            }
                          }}
                        />
                      }
                    >
                      <Divider class="settings-sep" />
                    </Show>
                  )}
                </For>
              )}
            </Show>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            'align-items': 'center',
            'justify-content': 'space-between',
            gap: '12px',
            padding: '12px 16px',
            'border-top': '1px solid var(--border)',
            'background-color': 'var(--bg-surface)'
          }}
        >
          <Show when={dirty()} fallback={<span />}>
            <Badge tone="warning">Unsaved changes</Badge>
          </Show>
          <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
            <Show when={section()}>
              <Button variant="danger" onClick={() => setResetPrompt(true)}>
                Reset section
              </Button>
            </Show>
            <Button variant="ghost" onClick={() => void tryBack()}>
              Back
            </Button>
            <Button variant="primary" onClick={() => void save()}>
              Save
              <Kbd keys={['ctrl', 's']} platform={window.gravlax.platform} />
            </Button>
          </div>
        </div>
      </section>
      <Show when={leavePrompt()}>
        <Modal
          title="Unsaved settings"
          description="You have unsaved changes in this section."
          options={['Save & Exit', 'Discard']}
          defaultIndex={0}
          onChoose={async (index) => {
            setLeavePrompt(false)
            if (index === 0) {
              if (await save()) props.onBack()
              return
            }
            setDraft(structuredClone(props.config))
            setDirty(false)
            props.onBack()
          }}
        />
      </Show>
      <Show when={resetPrompt() && section()}>
        <Modal
          title="Reset section?"
          description="Restore this section to its default values. You still need to save to persist."
          options={['Reset', 'Cancel']}
          destructiveIndex={0}
          defaultIndex={1}
          onChoose={async (index) => {
            setResetPrompt(false)
            if (index !== 0) return
            const current = section()
            if (!current) return
            const next = await window.gravlax.config.resetSection(current.id)
            setDraft(next)
            setDirty(true)
          }}
        />
      </Show>
    </div>
  )
}

function WorkspacePanel() {
  const [workspaceSize, setWorkspaceSize] = createSignal<number | null>(null)
  const [clearPrompt, setClearPrompt] = createSignal(false)

  const refreshWorkspaceSize = async (): Promise<void> => {
    setWorkspaceSize(await window.gravlax.cache.size())
  }

  onMount(() => void refreshWorkspaceSize())

  const sizeLabel = (): string =>
    workspaceSize() === null ? 'calculating…' : formatByteSize(workspaceSize()!)

  return (
    <>
      <Callout tone="warning">
        <Icon name="alert-triangle" size={16} />
        <div>
          <div style={{ 'font-weight': 600 }}>Destructive action</div>
          <div>
            Clearing the workspace cancels active uploads and permanently removes local working copies,
            generated files, and saved upload state. You will not be able to resume those uploads. Your
            original release folders and files already sent to a torrent client or seedbox stay untouched.
          </div>
        </div>
      </Callout>
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          'justify-content': 'space-between',
          gap: 'var(--space-4)',
          padding: 'var(--space-4) 0'
        }}
      >
        <div>
          <div style={{ 'font-weight': 600 }}>Clear workspace</div>
          <div style={{ color: 'var(--fg-secondary)', 'font-size': 'var(--text-sm)', 'margin-top': '4px' }}>
            Permanently remove {sizeLabel()} of local workspace files.
          </div>
        </div>
        <Button variant="danger" onClick={() => setClearPrompt(true)} disabled={workspaceSize() === null}>
          Clear workspace
        </Button>
      </div>
      <Show when={clearPrompt()}>
        <Modal
          title="Clear workspace?"
          description={`This will cancel active uploads and permanently delete ${sizeLabel()} of local workspace files, including working copies, generated files, and saved upload state. You will not be able to resume those uploads. Original release folders and files already sent to a torrent client or seedbox will not be deleted.`}
          options={[`Clear workspace (${sizeLabel()})`, 'Cancel']}
          destructiveIndex={0}
          defaultIndex={1}
          onChoose={async (index) => {
            if (index === 0) {
              await window.gravlax.cache.clear()
              setWorkspaceSize(0)
            }
            setClearPrompt(false)
          }}
        />
      </Show>
    </>
  )
}

function StatisticsPanel(props: { stats: UploadStats | null }) {
  const number = new Intl.NumberFormat()
  const trackerRows = (): Array<{ label: string; count: number }> => {
    const stats = props.stats
    return [
      { label: 'Redacted', count: stats?.trackers.redacted ?? 0 },
      { label: 'Orpheus', count: stats?.trackers.orpheus ?? 0 }
    ]
  }
  const formatRows = (): Array<{ id: string; label: string; count: number }> => {
    const stats = props.stats
    return Object.entries(stats?.formats ?? {})
      .map(([id, count]) => ({ id, label: formatLabel(id), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
  }

  return (
    <Show when={props.stats} fallback={<div style={{ color: 'var(--fg-muted)' }}>Loading statistics…</div>}>
      {(stats) => (
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: 'var(--space-5)' }}>
          <div
            style={{
              padding: 'var(--space-4)',
              border: '1px solid var(--border)',
              'border-radius': 'var(--radius-md)',
              'background-color': 'var(--bg-surface)'
            }}
          >
            <div style={{ color: 'var(--fg-secondary)', 'font-size': 'var(--text-sm)' }}>
              Total uploads
            </div>
            <div style={{ 'font-size': 'var(--text-2xl)', 'font-weight': 700, 'margin-top': '4px' }}>
              {number.format(totalUploads(stats()))}
            </div>
          </div>

          <StatsBreakdown title="By format" rows={formatRows()} empty="No formats uploaded yet." />
          <StatsBreakdown title="By tracker" rows={trackerRows()} />
        </div>
      )}
    </Show>
  )
}

function StatsBreakdown(props: {
  title: string
  rows: Array<{ label: string; count: number }>
  empty?: string
}) {
  const number = new Intl.NumberFormat()
  return (
    <div>
      <div style={{ 'font-weight': 600, 'margin-bottom': '8px' }}>{props.title}</div>
      <Show when={props.rows.length > 0} fallback={<div style={{ color: 'var(--fg-muted)' }}>{props.empty}</div>}>
        <div style={{ border: '1px solid var(--border)', 'border-radius': 'var(--radius-md)' }}>
          <For each={props.rows}>
            {(row, index) => (
              <div
                style={{
                  display: 'flex',
                  'justify-content': 'space-between',
                  gap: 'var(--space-4)',
                  padding: '10px var(--space-3)',
                  'border-top': index() === 0 ? '0' : '1px solid var(--border)'
                }}
              >
                <span>{row.label}</span>
                <span class="mono" style={{ color: 'var(--fg-secondary)' }}>
                  {number.format(row.count)}
                </span>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  )
}

function formatLabel(id: string): string {
  if (id === 'source') return 'Source'
  const transcode = /^transcode-(.+)$/.exec(id)
  if (transcode) return `MP3 ${transcode[1]}`
  const downconvert = /^downconvert-(16|24)-(\d+)$/.exec(id)
  if (downconvert) {
    const bitDepth = downconvert[1]
    const sampleRate = Number(downconvert[2]) / 1000
    return `${bitDepth}-bit FLAC · ${sampleRate.toFixed(1)} kHz`
  }
  return id
}

function StatusWarn() {
  return <span style={{ color: 'var(--error)', display: 'flex' }}><Icon name="alert-triangle" size={12} /></span>
}

function FieldRow(props: {
  field: FieldMetadata
  value: string
  options: string[]
  issue?: ValidationIssue
  revealed: boolean
  disabled?: boolean
  onReveal: () => void
  onChange: (value: string | boolean | number) => void
  onPickPath: () => void
}) {
  const label = (): string => {
    if (props.field.name.startsWith('thesungod.')) {
      return props.field.label.replace('thesungod', 'Ra (thesungod)')
    }
    return props.field.label
  }

  const enumLabel = (value: string): string => {
    if (props.field.name === 'theme') {
      if (value === 'system') return 'System'
      if (value === 'dark') return 'Dark'
      if (value === 'light') return 'Light'
    }
    if (props.field.name === 'albumDescriptionTemplateId') {
      return descriptionTemplateName(value)
    }
    return value
  }

  const trackerId = (): ReturnType<typeof trackerIdFromFieldName> => {
    const name = props.field.name
    if (name === 'redacted.enabled' || name === 'orpheus.enabled') {
      return trackerIdFromFieldName(name)
    }
    return null
  }

  const providerName = (): string | null => {
    const name = props.field.name
    if (!name.endsWith('.enabled')) return null
    return providerFromFieldName(name)
  }

  const inlineIconToggle = (): boolean =>
    props.field.type === 'bool' && (trackerId() != null || providerName() != null)

  return (
    <div style={{ 'margin-bottom': '18px' }}>
      <div
        style={{
          display: 'flex',
          'align-items': 'center',
          gap: '8px',
          'margin-bottom': inlineIconToggle() ? '0' : '6px'
        }}
      >
        <Show when={props.issue}>
          <span style={{ color: 'var(--error)', display: 'flex' }}>
            <Icon name="alert-triangle" size={13} />
          </span>
        </Show>
        <label class="settings-field-label">
          <Show when={trackerId()}>
            {(id) => <TrackerIcon trackerId={id()} size={16} />}
          </Show>
          <Show when={providerName()}>
            {(name) => <ProviderIcon provider={name()} size={16} />}
          </Show>
          <span>{label()}</span>
        </label>
        <Show when={inlineIconToggle()}>
          <Toggle
            on={props.value === 'true'}
            label={label()}
            disabled={props.disabled}
            onChange={(on) => props.onChange(on)}
          />
        </Show>
      </div>
      <Show when={props.field.description}>
        <div style={{ color: 'var(--fg-muted)', 'font-size': 'var(--text-sm)', 'margin-bottom': '8px' }}>
          {props.field.description}
        </div>
      </Show>
      <Show when={props.field.type === 'bool' && !inlineIconToggle()}>
        <Toggle
          on={props.value === 'true'}
          label={label()}
          disabled={props.disabled}
          onChange={(on) => props.onChange(on)}
        />
      </Show>
      <Show when={props.field.type === 'enum'}>
        <Select
          value={props.value}
          options={props.options}
          labelFor={enumLabel}
          onChange={(value) => props.onChange(value)}
        />
      </Show>
      <Show when={props.field.type === 'path' || props.field.type === 'file'}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <input
            class="mono"
            style={{ flex: 1 }}
            value={props.value}
            disabled={props.disabled}
            onInput={(e) => props.onChange(e.currentTarget.value)}
          />
          <Button variant="secondary" disabled={props.disabled} onClick={props.onPickPath}>
            Browse
          </Button>
        </div>
      </Show>
      <Show
        when={
          props.field.type === 'string' ||
          props.field.type === 'url' ||
          props.field.type === 'number'
        }
      >
        <div style={{ display: 'flex', gap: '8px', 'align-items': 'center' }}>
          <input
            class="mono"
            style={{ flex: 1 }}
            type={
              props.field.sensitive && !props.revealed
                ? 'password'
                : props.field.type === 'number'
                  ? 'number'
                  : 'text'
            }
            value={props.value}
            disabled={props.disabled}
            onInput={(e) =>
              props.onChange(
                props.field.type === 'number' ? Number(e.currentTarget.value) : e.currentTarget.value
              )
            }
          />
          <Show when={props.field.sensitive}>
            <IconButton
              icon={props.revealed ? 'eye-off' : 'eye'}
              label={props.revealed ? 'Hide' : 'Reveal'}
              onClick={props.onReveal}
            />
          </Show>
        </div>
      </Show>
      <Show when={props.issue}>
        <div style={{ color: 'var(--error)', 'font-size': 'var(--text-sm)', 'margin-top': '6px' }}>
          {props.issue!.message}
        </div>
      </Show>
    </div>
  )
}

function enumOptions(cfg: Config, section: SectionID, field: FieldMetadata): string[] {
  if (section === 'spectral' && field.name === 'imageHost') {
    return enabledSpectralImageHostOptions(cfg)
  }
  if (section === 'trackers' && field.name === 'redacted.coverImageHost') {
    return coverImageHostOptions(cfg, 'redacted')
  }
  if (section === 'trackers' && field.name === 'orpheus.coverImageHost') {
    return coverImageHostOptions(cfg, 'orpheus')
  }
  if (section === 'naming' && field.name === 'albumDescriptionTemplateId') {
    return listDescriptionTemplateIds()
  }
  return field.options ?? []
}

function fieldValue(cfg: Config, section: SectionID, field: FieldMetadata): string {
  const sectionValue = cfg[section] as unknown as Record<string, unknown>
  if (field.name.includes('.')) {
    const [group, key] = field.name.split('.')
    const nested = sectionValue[group!] as Record<string, unknown> | undefined
    const value = nested?.[key!]
    return value == null ? '' : String(value)
  }
  if (section === 'spectral' && field.name === 'defaultSpectralIdsForLossy') {
    return String(
      (cfg.spectral as { defaultSpectralIdsForLossyMasters: string }).defaultSpectralIdsForLossyMasters ??
        ''
    )
  }
  const value = sectionValue[field.name]
  return value == null ? '' : String(value)
}

async function applyField(
  cfg: Config,
  section: SectionID,
  field: FieldMetadata,
  value: string | boolean | number
): Promise<Config> {
  const next = structuredClone(cfg)
  const target = next[section] as unknown as Record<string, unknown>
  if (field.name.includes('.')) {
    const [group, key] = field.name.split('.')
    const nested = { ...(target[group!] as Record<string, unknown>) }
    nested[key!] = value
    target[group!] = nested
    if (section === 'imageHosts' && field.name === 'redacted.enabled' && value === true) {
      if (!canEnableRedactedImageHost(next)) {
        next.imageHosts.redacted.enabled = false
      }
    }
    if (section === 'trackers' && !canEnableRedactedImageHost(next)) {
      next.imageHosts.redacted.enabled = false
    }
    if (section === 'trackers' || section === 'imageHosts') {
      sanitizeCoverImageHosts(next)
    }
    return next
  }
  if (section === 'spectral' && field.name === 'defaultSpectralIdsForLossy') {
    ;(next.spectral as { defaultSpectralIdsForLossyMasters: string }).defaultSpectralIdsForLossyMasters =
      String(value)
    return next
  }
  target[field.name] = value
  return next
}
