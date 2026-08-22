import { For, Index, Show, createMemo } from 'solid-js'
import type { Artist, Track, UploadFlowStateJSON } from '@shared/types'
import type { Config } from '@shared/types/config'
import { buildFilesRenamePlan } from '@shared/upload/naming'
import {
  FIELD_ARTISTS,
  FIELD_ORDER,
  FIELD_RELEASE_TYPE,
  TRACK_FIELD_ORDER
} from '@shared/types/upload'
import { STANDARD_RELEASE_TYPES } from '@shared/upload/releaseTypes'
import {
  displayTrackValueLines,
  displayValueLines,
  editorTrackValue,
  editorValue,
  fieldDisplayName,
  fieldEditable,
  fieldMultiline,
  isMultiDiscTracks,
  setFieldEditorValue,
  setTrackFieldEditorValue,
  trackHeading
} from '@shared/tags/editor'
import { Button, Callout, IconButton, Spinner, StatusDot } from '../../../ui'
import { Toggle } from '../../../components/Toggle'
import { Select } from '../../../components/Select'
import { ArtistsEditor } from '../ArtistsEditor'

export function TagsStep(props: {
  state: UploadFlowStateJSON
  config: Config
  editingField: string | null
  editingTrackIndex: number | null
  editValue: string
  editArtists: Artist[]
  onStartEdit: (field: string, trackIndex?: number) => void
  onCancelEdit: () => void
  onCommitEdit: () => void
  onEditValueChange: (value: string) => void
  onEditArtistsChange: (artists: Artist[]) => void
  onFieldBlur: () => void
  focusFieldEditor: (el: HTMLInputElement | HTMLTextAreaElement) => void
  onReload: () => void
}) {
  const currentTracks = (): Track[] => props.state.tags.current?.tracks ?? []
  const proposedTracks = (): Track[] => props.state.tags.proposed?.tracks ?? []
  const trackCount = (): number => Math.max(currentTracks().length, proposedTracks().length)
  const multiDisc = (): boolean =>
    isMultiDiscTracks([...currentTracks(), ...proposedTracks()])
  const plan = createMemo(() => buildFilesRenamePlan({
    release: props.state.tags.proposed ?? {},
    files: props.state.files,
    naming: props.config.naming,
    sourceMedia: props.state.draft.sourceMedia,
    encoding: props.state.transcode.inspection?.encoding
  }))
  const locked = (): boolean =>
    (props.state.upload.submissions ?? []).some((item) => item.status === 'done') ||
    props.state.upload.phase === 'submitting' || props.state.seed.phase !== 'idle'
  const busy = (): boolean =>
    props.state.files.apply.phase === 'applying' || props.state.files.apply.phase === 'restoring'

  const revertField = (field: string): void => {
    const currentValue = editorValue(props.state.tags.current ?? {}, field)
    const next = setFieldEditorValue(props.state.tags.proposed ?? {}, field, currentValue)
    void window.gravlax.upload.updateTagsProposed(next)
  }

  const revertTrackField = (trackIndex: number, field: string): void => {
    const currentValue = editorTrackValue(currentTracks()[trackIndex], field)
    const next = setTrackFieldEditorValue(
      props.state.tags.proposed ?? {},
      trackIndex,
      field,
      currentValue
    )
    void window.gravlax.upload.updateTagsProposed(next)
  }

  return (
    <div class="tags-view">
      <div class="files-change-status">
        <div class="files-change-status-text" role="status" aria-live="polite">
          <Show when={busy()}>
            <Spinner size="sm" />
          </Show>
          <div>
            <strong>Files on disk:</strong>{' '}
            {props.state.files.apply.phase === 'applying'
              ? 'applying tags and filenames…'
              : props.state.files.apply.phase === 'restoring'
                ? 'restoring original tags and filenames…'
                : props.state.files.apply.phase === 'applied'
                  ? `tags applied, ${props.state.files.apply.changedFileCount ?? 0} renamed, ${props.state.files.apply.strippedPictureCount ?? 0} cover images stripped`
                  : props.state.files.apply.phase === 'failed'
                    ? props.state.files.apply.error
                    : props.state.files.apply.onDiskModified ? 'modified (new changes pending)' : 'original'}
          </div>
        </div>
        <Show when={props.state.files.original.captured}>
          <Button
            variant="secondary"
            size="sm"
            disabled={
              busy() || locked() ||
              (!props.state.files.apply.onDiskModified && props.state.files.apply.phase !== 'failed')
            }
            onClick={() => void window.gravlax.upload.revertFiles()}
          >
            Restore original tags
          </Button>
        </Show>
      </div>

      <Show when={props.state.tags.releaseStatus === 'loading'}>
        <Callout tone="info" class="tags-release-status">
          <Spinner size="sm" /> Loading metadata for the selected release…
        </Callout>
      </Show>

      <Show when={props.state.tags.releaseStatus === 'failed'}>
        <Callout tone="error" class="tags-release-status">
          <div>
            Could not load metadata for the selected release.
            <Show when={props.state.tags.releaseError}>
              {(error) => <div class="tags-release-error">{error()}</div>}
            </Show>
          </div>
          <Button variant="secondary" size="sm" onClick={props.onReload}>
            Retry
          </Button>
        </Callout>
      </Show>

      <Show when={props.state.tags.releaseStatus !== 'loading'}>
        <div class="tags-table-wrap">
          <table class="tags-table">
          <thead>
            <tr>
              <th>Field</th>
              <th>Current</th>
              <th>Proposed</th>
            </tr>
          </thead>
          <tbody>
            <For each={[...FIELD_ORDER]}>
              {(field) => {
                const current = (): string[] =>
                  displayValueLines(props.state.tags.current ?? {}, field)
                const proposed = (): string[] =>
                  displayValueLines(props.state.tags.proposed ?? {}, field)
                const changed = (): boolean => current().join('\n') !== proposed().join('\n')
                const editing = (): boolean =>
                  props.editingTrackIndex == null && props.editingField === field
                return (
                  <tr class={changed() ? 'tags-row-changed' : ''}>
                    <td class="tags-field-name">
                      <div class="tags-field-label">
                        <span class="tags-change-slot" aria-hidden={!changed()}>
                          <Show when={changed()}>
                            <StatusDot color="var(--accent)" title="Changed" />
                          </Show>
                        </span>
                        {fieldDisplayName(field)}
                      </div>
                    </td>
                    <td class="mono tags-cell-current">
                      <TagsValueLines lines={current()} />
                    </td>
                    <td class="tags-cell-proposed">
                      <div class="tags-proposed-wrap">
                        <div class="tags-proposed-main">
                          <Show
                            when={editing()}
                            fallback={
                              <span
                                class="mono tags-proposed-value"
                                classList={{ 'tags-proposed-changed': changed() }}
                                role={fieldEditable(field) ? 'button' : undefined}
                                tabIndex={fieldEditable(field) ? 0 : undefined}
                                onClick={() => props.onStartEdit(field)}
                                onKeyDown={(event) => {
                                  if (!fieldEditable(field)) return
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    props.onStartEdit(field)
                                  }
                                }}
                              >
                                <TagsValueLines lines={proposed()} />
                              </span>
                            }
                          >
                            <FieldEditor
                              field={field}
                              editValue={props.editValue}
                              editArtists={props.editArtists}
                              onEditValueChange={props.onEditValueChange}
                              onEditArtistsChange={props.onEditArtistsChange}
                              onCommitEdit={props.onCommitEdit}
                              onFieldBlur={props.onFieldBlur}
                              focusFieldEditor={props.focusFieldEditor}
                            />
                          </Show>
                        </div>
                        <div class="tags-revert-slot">
                          <Show when={changed() && !editing()}>
                            <IconButton
                              icon="refresh-cw"
                              label="Revert field"
                              size="sm"
                              onClick={() => revertField(field)}
                            />
                          </Show>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              }}
            </For>
          </tbody>
          </table>
        </div>

        <Show when={(props.state.files.original.embeddedCoverArtCount ?? 0) > 0}>
          <label class="tags-toggle-row">
            <Toggle
              on={props.state.files.apply.stripEmbeddedCoverArt}
              disabled={busy() || locked()}
              onChange={(value) => void window.gravlax.upload.setStripEmbeddedCoverArt(value)}
            />
            <span><strong>Strip embedded cover art</strong><small>External cover files stay unchanged.</small></span>
          </label>
        </Show>

        <Show when={trackCount() > 0}>
          <section class="tags-tracks">
          <h3 class="tags-tracks-heading">Tracks</h3>
          <For each={Array.from({ length: trackCount() }, (_, index) => index)}>
            {(trackIndex) => {
              const currentTrack = (): Track | undefined => currentTracks()[trackIndex]
              const proposedTrack = (): Track | undefined => proposedTracks()[trackIndex]
              return (
                <div class="tags-track">
                  <h4 class="tags-track-title">
                    {trackHeading(
                      proposedTrack() ?? currentTrack(),
                      trackIndex,
                      multiDisc()
                    )}
                  </h4>
                  <table class="tags-table">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Current</th>
                        <th>Proposed</th>
                      </tr>
                    </thead>
                    <tbody>
                      <For each={[...TRACK_FIELD_ORDER]}>
                        {(field) => {
                          const current = (): string[] =>
                            displayTrackValueLines(currentTrack(), field)
                          const proposed = (): string[] =>
                            displayTrackValueLines(proposedTrack(), field)
                          const changed = (): boolean =>
                            current().join('\n') !== proposed().join('\n')
                          const editing = (): boolean =>
                            props.editingTrackIndex === trackIndex &&
                            props.editingField === field
                          return (
                            <tr class={changed() ? 'tags-row-changed' : ''}>
                              <td class="tags-field-name">
                                <div class="tags-field-label">
                                  <span class="tags-change-slot" aria-hidden={!changed()}>
                                    <Show when={changed()}>
                                      <StatusDot color="var(--accent)" title="Changed" />
                                    </Show>
                                  </span>
                                  {fieldDisplayName(field)}
                                </div>
                              </td>
                              <td class="mono tags-cell-current">
                                <TagsValueLines lines={current()} />
                              </td>
                              <td class="tags-cell-proposed">
                                <div class="tags-proposed-wrap">
                                  <div class="tags-proposed-main">
                                    <Show
                                      when={editing()}
                                      fallback={
                                        <span
                                          class="mono tags-proposed-value"
                                          classList={{ 'tags-proposed-changed': changed() }}
                                          role="button"
                                          tabIndex={0}
                                          onClick={() => props.onStartEdit(field, trackIndex)}
                                          onKeyDown={(event) => {
                                            if (event.key === 'Enter' || event.key === ' ') {
                                              event.preventDefault()
                                              props.onStartEdit(field, trackIndex)
                                            }
                                          }}
                                        >
                                          <TagsValueLines lines={proposed()} />
                                        </span>
                                      }
                                    >
                                      <FieldEditor
                                        field={field}
                                        editValue={props.editValue}
                                        editArtists={props.editArtists}
                                        onEditValueChange={props.onEditValueChange}
                                        onEditArtistsChange={props.onEditArtistsChange}
                                        onCommitEdit={props.onCommitEdit}
                                        onFieldBlur={props.onFieldBlur}
                                        focusFieldEditor={props.focusFieldEditor}
                                      />
                                    </Show>
                                  </div>
                                  <div class="tags-revert-slot">
                                    <Show when={changed() && !editing()}>
                                      <IconButton
                                        icon="refresh-cw"
                                        label="Revert field"
                                        size="sm"
                                        onClick={() => revertTrackField(trackIndex, field)}
                                      />
                                    </Show>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          )
                        }}
                      </For>
                    </tbody>
                  </table>
                </div>
              )
            }}
          </For>
          </section>
        </Show>
      </Show>

      <section class="filenames-section">
        <div class="filenames-heading">
          <div>
            <h3>Filenames</h3>
            <p>Names come from Settings → Naming. You can override any name for this upload.</p>
          </div>
        </div>

        <label class="filename-toggle-row">
          <Toggle
            on={props.state.files.apply.renameReleaseFolder}
            disabled={busy() || locked()}
            onChange={(value) => void window.gravlax.upload.setRenameReleaseFolder(value)}
          />
          <span><strong>Rename release folder</strong><small>{props.config.naming.releaseFolderTemplate}</small></span>
        </label>

        <Show when={props.state.files.apply.renameReleaseFolder}>
          <div class="filename-edit-row">
            <span class="mono filename-current">{props.state.files.apply.currentFolderName}</span>
            <span>→</span>
            <input
              class="mono filename-input"
              disabled={busy() || locked()}
              value={props.state.files.apply.folderNameOverride ?? plan().folderName}
              onChange={(event) => void window.gravlax.upload.setFolderNameOverride(event.currentTarget.value)}
              aria-label="Release folder name"
            />
            <IconButton
              icon="refresh-cw"
              label="Reset release folder name"
              size="sm"
              disabled={!props.state.files.apply.folderNameOverride || busy() || locked()}
              onClick={() => void window.gravlax.upload.setFolderNameOverride()}
            />
          </div>
        </Show>

        <div class="filename-list">
          <Index each={plan().files}>
            {(file) => {
              const stateFile = () =>
                props.state.files.apply.files.find((item) => item.id === file().id)
              return (
                <div class="filename-edit-row">
                  <span class="mono filename-current">{file().currentPath}</span>
                  <span>→</span>
                  <div class="filename-target">
                    <Show when={file().targetPath.slice(0, -file().targetFilename.length)}>
                      <span class="mono filename-directory">
                        {file().targetPath.slice(0, -file().targetFilename.length)}
                      </span>
                    </Show>
                    <input
                      class="mono filename-input"
                      disabled={busy() || locked()}
                      value={stateFile()?.filenameOverride ?? file().targetFilename}
                      onChange={(event) =>
                        void window.gravlax.upload.setFilenameOverride(
                          file().id,
                          event.currentTarget.value
                        )
                      }
                      aria-label={`Filename for ${file().currentPath}`}
                    />
                  </div>
                  <IconButton
                    icon="refresh-cw"
                    label="Reset filename"
                    size="sm"
                    disabled={!stateFile()?.filenameOverride || busy() || locked()}
                    onClick={() => void window.gravlax.upload.setFilenameOverride(file().id)}
                  />
                </div>
              )
            }}
          </Index>
        </div>

        <Show when={plan().errors.length > 0}>
          <div class="filename-errors">
            <For each={plan().errors}>{(error) => <div>{error}</div>}</For>
          </div>
        </Show>
        <Show when={plan().warnings.length > 0}>
          <div class="filename-warnings">
            <For each={plan().warnings}>{(warning) => <div>{warning}</div>}</For>
          </div>
        </Show>
      </section>
    </div>
  )
}

function TagsValueLines(props: { lines: string[] }) {
  return (
    <span class="tags-value-lines">
      <For each={props.lines}>{(line) => <span class="tags-value-line">{line}</span>}</For>
    </span>
  )
}

function FieldEditor(props: {
  field: string
  editValue: string
  editArtists: Artist[]
  onEditValueChange: (value: string) => void
  onEditArtistsChange: (artists: Artist[]) => void
  onCommitEdit: () => void
  onFieldBlur: () => void
  focusFieldEditor: (el: HTMLInputElement | HTMLTextAreaElement) => void
}) {
  return (
    <Show
      when={props.field === FIELD_ARTISTS}
      fallback={
        <Show
          when={props.field === FIELD_RELEASE_TYPE}
          fallback={
            <Show
              when={fieldMultiline(props.field)}
              fallback={
                <input
                  class="mono tags-field-input"
                  ref={props.focusFieldEditor}
                  value={props.editValue}
                  onInput={(event) => props.onEditValueChange(event.currentTarget.value)}
                  onBlur={props.onFieldBlur}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      props.onCommitEdit()
                    }
                  }}
                />
              }
            >
              <textarea
                class="mono tags-field-input"
                ref={props.focusFieldEditor}
                rows={Math.max(3, props.editValue.split('\n').length)}
                value={props.editValue}
                onInput={(event) => props.onEditValueChange(event.currentTarget.value)}
                onBlur={props.onFieldBlur}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    props.onCommitEdit()
                  }
                }}
              />
            </Show>
          }
        >
          <Select
            value={props.editValue}
            options={[...STANDARD_RELEASE_TYPES]}
            class="tags-release-type-select"
            onChange={(value) => {
              props.onEditValueChange(value)
              props.onCommitEdit()
            }}
          />
        </Show>
      }
    >
      <ArtistsEditor
        artists={props.editArtists}
        onChange={props.onEditArtistsChange}
        onCommit={props.onCommitEdit}
        onFieldBlur={props.onFieldBlur}
      />
    </Show>
  )
}
