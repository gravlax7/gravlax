import { For, Show, createSignal, type JSX } from 'solid-js'
import type {
  UploadStartEntries,
  UploadStartNewEntry,
  UploadStartResumeEntry,
  UploadedReleaseRecord
} from '@shared/types'
import { UPLOAD_STEPS } from '@shared/upload/stepGating'
import { Badge, Button, EmptyState, Icon, Spinner } from '../../ui'

export function UploadStartMenu(props: {
  entries: UploadStartEntries | null
  loading: boolean
  onRefresh: () => void
  onOpenPath: (path: string) => void
  onResume: (entry: UploadStartResumeEntry) => void
  onUploaded: (entry: UploadedReleaseRecord) => void
}) {
  const [dragging, setDragging] = createSignal(false)
  const count = () => {
    const entries = props.entries
    return entries
      ? entries.newEntries.length + entries.resumeEntries.length + entries.uploadedEntries.length
      : 0
  }

  const browse = async (): Promise<void> => {
    const path = await window.gravlax.dialog.pickDirectory()
    if (path) props.onOpenPath(path)
  }

  const onDrop = (event: DragEvent): void => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer?.files[0]
    if (!file) return
    const path = window.gravlax.files.getPathForFile(file)
    if (path) props.onOpenPath(path)
  }

  return (
    <div class="upload-start-screen">
      <header class="upload-start-header">
        <div>
          <h1 class="upload-start-title">Upload</h1>
          <p class="upload-start-subtitle">Start a release or pick up where you left off.</p>
        </div>
        <div class="upload-start-actions">
          <Button variant="ghost" onClick={props.onRefresh} disabled={props.loading}>
            <Icon name="refresh-cw" size={14} /> Refresh
          </Button>
        </div>
      </header>

      <div class="upload-start-body">
        <div class="content-frame upload-start-content">
          <div class={`upload-start-picker ${dragging() ? 'upload-start-picker-active' : ''}`}>
            <div
              class="upload-start-drop"
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
            >
              <Icon name="folder" size={16} />
              <span>Drop a release folder here</span>
            </div>
            <span class="upload-start-picker-or">or</span>
            <Button variant="secondary" size="sm" onClick={() => void browse()}>
              <Icon name="folder" size={14} /> Browse…
            </Button>
          </div>

          <Show when={props.entries?.sourceError}>
            {(error) => <div class="ui-callout ui-callout-error">{error()}</div>}
          </Show>

          <Show when={props.loading && !props.entries}>
            <div class="upload-start-loading"><Spinner /> Loading releases…</div>
          </Show>

          <Show when={props.entries?.newEntries.length}>
            <StartSection title="New" count={props.entries!.newEntries.length}>
              <For each={props.entries!.newEntries}>
                {(entry: UploadStartNewEntry) => (
                  <StartRow
                    name={entry.name}
                    path={entry.sourcePath}
                    icon="plus"
                    onClick={() => props.onOpenPath(entry.sourcePath)}
                  />
                )}
              </For>
            </StartSection>
          </Show>

          <Show when={props.entries?.resumeEntries.length}>
            <StartSection title="Resume" count={props.entries!.resumeEntries.length}>
              <For each={props.entries!.resumeEntries}>
                {(entry) => (
                  <StartRow
                    name={entry.name}
                    path={entry.sourcePath}
                    icon="refresh-cw"
                    warning={!entry.sourceExists}
                    badge={UPLOAD_STEPS.find((step) => step.id === entry.currentStepID)?.title ?? 'Files Check'}
                    onClick={() => props.onResume(entry)}
                  />
                )}
              </For>
            </StartSection>
          </Show>

          <Show when={props.entries?.uploadedEntries.length}>
            <StartSection title="Uploaded" count={props.entries!.uploadedEntries.length}>
              <For each={props.entries!.uploadedEntries}>
                {(entry) => (
                  <StartRow
                    name={entry.title || entry.name}
                    path={entry.sourcePath}
                    icon="check"
                    warning={!entry.sourceExists}
                    badge={new Date(entry.completedAt).toLocaleDateString()}
                    onClick={() => props.onUploaded(entry)}
                  />
                )}
              </For>
            </StartSection>
          </Show>

          <Show when={props.entries && count() === 0 && !props.loading}>
            <EmptyState
              icon="folder"
              title="No releases yet"
              description="Add folders to your source directory or browse to a release folder."
            />
          </Show>
        </div>
      </div>
    </div>
  )
}

function StartSection(props: { title: string; count: number; children: JSX.Element }) {
  return (
    <section class="upload-start-section">
      <div class="upload-start-section-heading">
        <h2>{props.title}</h2>
        <span>{props.count}</span>
      </div>
      <div class="upload-start-list">{props.children}</div>
    </section>
  )
}

function StartRow(props: {
  name: string
  path: string
  icon: 'plus' | 'refresh-cw' | 'check'
  badge?: string
  warning?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" class="upload-start-row" onClick={props.onClick}>
      <span class={`upload-start-row-icon upload-start-row-icon-${props.icon}`}>
        <Icon name={props.warning ? 'alert-triangle' : props.icon} size={15} />
      </span>
      <span class="upload-start-row-text">
        <span class="upload-start-row-name">{props.name}</span>
        <span class="upload-start-row-path mono">{props.path}</span>
      </span>
      <Show when={props.badge}>
        <Badge tone={props.warning ? 'warning' : 'neutral'}>{props.badge}</Badge>
      </Show>
      <Icon name="chevron-right" size={14} />
    </button>
  )
}

export function UploadedSummary(props: {
  entry: UploadedReleaseRecord
  starting: boolean
  onBack: () => void
  onStartAgain: () => void
}) {
  const heading = () => {
    const artists = props.entry.artists.join(', ')
    return [artists, props.entry.title].filter(Boolean).join(' — ') || props.entry.name
  }
  return (
    <div class="upload-start-screen">
      <header class="upload-start-header">
        <div>
          <Button variant="ghost" size="sm" onClick={props.onBack}>
            <Icon name="chevron-left" size={14} /> Uploads
          </Button>
          <h1 class="upload-start-title upload-summary-title">{heading()}</h1>
          <p class="upload-start-subtitle">
            Uploaded {new Date(props.entry.completedAt).toLocaleString()}
          </p>
        </div>
        <Button
          variant="primary"
          loading={props.starting}
          disabled={!props.entry.sourceExists}
          onClick={props.onStartAgain}
        >
          <Icon name="plus" size={14} /> Start again
        </Button>
      </header>
      <div class="upload-start-body">
        <div class="content-frame upload-summary">
          <Show when={!props.entry.sourceExists}>
            <div class="ui-callout ui-callout-error">
              The source folder is missing. Put it back at the saved path to start again.
            </div>
          </Show>
          <div class="upload-summary-meta">
            <div><span>Source</span><strong class="mono">{props.entry.sourcePath}</strong></div>
            <Show when={props.entry.year}>
              {(year) => <div><span>Year</span><strong>{year()}</strong></div>}
            </Show>
          </div>
          <section class="upload-start-section">
            <div class="upload-start-section-heading"><h2>Tracker uploads</h2></div>
            <div class="upload-start-list">
              <For each={props.entry.submissions} fallback={<div class="upload-summary-empty">No tracker links were saved.</div>}>
                {(submission) => (
                  <button
                    type="button"
                    class="upload-start-row"
                    disabled={!submission.url}
                    onClick={() => submission.url && void window.gravlax.shell.openExternal(submission.url)}
                  >
                    <span class="upload-start-row-icon"><Icon name="globe" size={15} /></span>
                    <span class="upload-start-row-text">
                      <span class="upload-start-row-name">{submission.label}</span>
                      <span class="upload-start-row-path">{submission.trackerId}</span>
                    </span>
                    <Show when={submission.url}><Icon name="external-link" size={14} /></Show>
                  </button>
                )}
              </For>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
