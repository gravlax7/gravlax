import { For, Index, Show, createMemo } from 'solid-js'
import type { Artist, Track, UploadFlowStateJSON } from '@shared/types'
import type { Config } from '@shared/types/config'
import { buildFilesRenamePlan } from '@shared/upload/naming'
import {
  FIELD_ARTISTS,
  FIELD_ORDER,
  FIELD_RELEASE_TYPE,
  METADATA_PROVIDER_KEEP_EXISTING,
  TRACK_FIELD_ORDER
} from '@shared/types/upload'
import { STANDARD_RELEASE_TYPES } from '@shared/upload/releaseTypes'
import {
  displayTrackValueLines,
  displayValueLines,
  editorTrackValue,
  editorValue,
  artistCreditIsPending,
  fieldDisplayName,
  fieldEditable,
  fieldMultiline,
  isMultiDiscTracks,
  setFieldEditorValue,
  setTrackFieldEditorValue,
  textValueLinesEqual,
  trackHeading
} from '@shared/tags/editor'
import { Button, Callout, IconButton, Spinner, StatusDot } from '../../../ui'
import { Toggle } from '../../../components/Toggle'
import { Select } from '../../../components/Select'
import { ArtistsEditor, type ArtistEditAction } from '../ArtistsEditor'
import { SeparatorArtistBanner } from '../SeparatorArtistBanner'
import { invalidReleaseDateFields } from '@shared/tags/dates'
import { sourceRestoreUnavailableMessage } from '@shared/upload/sourceRestore'

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
  onEditArtist: (action: ArtistEditAction) => void
  onFieldBlur: () => void
  focusFieldEditor: (el: HTMLInputElement | HTMLTextAreaElement) => void
  onReload: () => void
}) {
  const keepExistingTags = (): boolean =>
    props.state.metadata.selected?.provider === METADATA_PROVIDER_KEEP_EXISTING
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
    encoding: props.state.transcode.inspection?.encoding,
    writeTags: !keepExistingTags()
  }))
  const locked = (): boolean =>
    (props.state.upload.submissions ?? []).some((item) => item.status === 'done') ||
    props.state.upload.phase === 'submitting' || props.state.seed.phase !== 'idle'
  const busy = (): boolean =>
    props.state.files.apply.phase === 'applying' || props.state.files.apply.phase === 'restoring'
  const invalidDates = (): string[] =>
    invalidReleaseDateFields(
      props.state.tags.proposed?.groupYear,
      props.state.tags.proposed?.year
    )
  const payloadState = (id: string) =>
    (props.state.files.apply.payloadPaths ?? []).find((item) => item.id === id)
  const currentFolders = () =>
    (props.state.files.apply.payloadPaths ?? []).filter((item) => item.kind === 'directory')
  const pathErrors = (currentPath: string, targetPath: string): string[] =>
    plan().errors.filter((error) =>
      error.startsWith(`${currentPath}:`) || error.startsWith(`${targetPath}:`)
    )

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
              ? 'applying selected changes…'
              : props.state.files.apply.phase === 'restoring'
                ? 'restoring original files…'
                : props.state.files.apply.phase === 'applied'
                  ? keepExistingTags() &&
                    (props.state.files.apply.changedFileCount ?? 0) === 0 &&
                    (props.state.files.apply.strippedPictureCount ?? 0) === 0
                    ? 'no file changes needed'
                    : `${keepExistingTags() ? 'tags kept' : 'tags applied'}, ${props.state.files.apply.changedFileCount ?? 0} renamed, ${props.state.files.apply.strippedPictureCount ?? 0} cover images stripped`
                  : props.state.files.apply.phase === 'failed'
                    ? props.state.files.apply.error
                  : props.state.files.apply.onDiskModified ? 'modified (new changes pending)' : 'original'}
            <Show when={
              props.state.files.original.restoreAvailable === false &&
              (props.state.files.apply.onDiskModified || props.state.files.apply.phase === 'failed')
            }>
              <div class="files-restore-unavailable">
                Restore unavailable: {sourceRestoreUnavailableMessage(
                  props.state.files.original.restoreUnavailableReason ?? 'unknown'
                )}
              </div>
            </Show>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          title={
            props.state.files.original.restoreAvailable === false
              ? sourceRestoreUnavailableMessage(props.state.files.original.restoreUnavailableReason ?? 'unknown')
              : undefined
          }
          disabled={
            busy() || locked() || props.state.files.original.restoreAvailable === false ||
            (!props.state.files.apply.onDiskModified && props.state.files.apply.phase !== 'failed')
          }
          onClick={() => void window.gravlax.upload.revertFiles()}
        >
          Restore original files
        </Button>
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
        <Show when={keepExistingTags()}>
          <Callout tone="info" class="tags-release-status">
            Gravlax will use the tags read from these FLAC files and will not rewrite them.
          </Callout>
        </Show>
        <SeparatorArtistBanner
          release={props.state.tags.proposed}
          onResolve={(next) => {
            props.onCancelEdit()
            void window.gravlax.upload.updateTagsProposed(next)
          }}
        />
        <Show when={invalidDates().length > 0}>
          <Callout tone="error" class="tags-release-status">
            Original and edition release dates must be YYYY, YYYY-MM, or YYYY-MM-DD.
          </Callout>
        </Show>
        <div class="tags-table-wrap">
          <table
            class="tags-table"
            classList={{ 'tags-table-readonly': keepExistingTags() }}
          >
            <thead>
              <tr>
                <th>Field</th>
                <th>Current</th>
                <Show when={!keepExistingTags()}>
                  <th>Proposed</th>
                </Show>
              </tr>
            </thead>
            <tbody>
              <For each={[...FIELD_ORDER]}>
                {(field) => {
                  const current = (): string[] =>
                    displayValueLines(props.state.tags.current ?? {}, field)
                  const proposed = (): string[] =>
                    displayValueLines(props.state.tags.proposed ?? {}, field)
                  const changed = (): boolean =>
                    !keepExistingTags() && !textValueLinesEqual(current(), proposed())
                  const editing = (): boolean =>
                    props.editingTrackIndex == null && props.editingField === field
                  const separatorPending = (): boolean =>
                    !keepExistingTags() &&
                    field === FIELD_ARTISTS &&
                    (props.state.tags.proposed?.artists ?? []).some(artistCreditIsPending)
                  return (
                    <tr
                      classList={{
                        'tags-row-changed': changed(),
                        'tags-row-separator-pending': separatorPending()
                      }}
                    >
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
                      <Show when={!keepExistingTags()}>
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
                                  onEditArtist={props.onEditArtist}
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
                      </Show>
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
                        keepExistingTags() ? currentTrack() : proposedTrack() ?? currentTrack(),
                        trackIndex,
                        multiDisc()
                      )}
                    </h4>
                    <table
                      class="tags-table"
                      classList={{ 'tags-table-readonly': keepExistingTags() }}
                    >
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Current</th>
                          <Show when={!keepExistingTags()}>
                            <th>Proposed</th>
                          </Show>
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
                              !keepExistingTags() && !textValueLinesEqual(current(), proposed())
                            const editing = (): boolean =>
                              props.editingTrackIndex === trackIndex &&
                              props.editingField === field
                            const separatorPending = (): boolean =>
                              !keepExistingTags() &&
                              field === FIELD_ARTISTS &&
                              (proposedTrack()?.artists ?? []).some(artistCreditIsPending)
                            return (
                              <tr
                                classList={{
                                  'tags-row-changed': changed(),
                                  'tags-row-separator-pending': separatorPending()
                                }}
                              >
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
                                <Show when={!keepExistingTags()}>
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
                                            onEditArtist={props.onEditArtist}
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
                                </Show>
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
            <p>Current names stay visible. Turn on a rename option to edit them for this upload.</p>
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

        <div
          class="filename-edit-row"
          classList={{ 'filename-edit-row-readonly': !props.state.files.apply.renameReleaseFolder }}
        >
          <span class="mono filename-current">{props.state.files.apply.currentFolderName}</span>
          <Show when={props.state.files.apply.renameReleaseFolder}>
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
          </Show>
        </div>

        <label class="filename-toggle-row">
          <Toggle
            on={props.state.files.apply.renameTrackFiles}
            disabled={busy() || locked()}
            onChange={(value) => void window.gravlax.upload.setRenameTrackFiles(value)}
          />
          <span><strong>Rename FLAC tracks</strong><small>{props.config.naming.trackFileTemplate}</small></span>
        </label>

        <Show when={
          props.state.files.apply.renameTrackFiles
            ? (plan().folders?.length ?? 0) > 0
            : currentFolders().length > 0
        }>
          <div class="filename-group-label">Folders</div>
          <Show
            when={props.state.files.apply.renameTrackFiles}
            fallback={
              <div class="filename-list">
                <For each={currentFolders()}>
                  {(folder) => (
                    <div class="filename-edit-row filename-edit-row-readonly">
                      <span class="mono filename-current">{folder.currentPath}</span>
                    </div>
                  )}
                </For>
              </div>
            }
          >
            <div class="filename-list">
              <For each={plan().folders ?? []}>
              {(folder) => (
                <div class="filename-entry">
                  <div class="filename-edit-row">
                    <span class="mono filename-current">{folder.currentPath}</span>
                    <span>→</span>
                    <div class="filename-target">
                      <Show when={folder.targetPath.slice(0, -folder.targetName.length)}>
                        <span class="mono filename-directory">
                          {folder.targetPath.slice(0, -folder.targetName.length)}
                        </span>
                      </Show>
                      <input
                        class="mono filename-input"
                        disabled={busy() || locked()}
                        value={payloadState(folder.id)?.nameOverride ?? folder.targetName}
                        onChange={(event) => void window.gravlax.upload.setPayloadNameOverride(folder.id, event.currentTarget.value)}
                        aria-label={`Folder name for ${folder.currentPath}`}
                      />
                    </div>
                    <IconButton
                      icon="refresh-cw"
                      label="Reset folder name"
                      size="sm"
                      disabled={!payloadState(folder.id)?.nameOverride || busy() || locked()}
                      onClick={() => void window.gravlax.upload.setPayloadNameOverride(folder.id)}
                    />
                  </div>
                  <For each={pathErrors(folder.currentPath, folder.targetPath)}>
                    {(error) => <div class="filename-row-error">{error}</div>}
                  </For>
                </div>
              )}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={plan().files.length > 0}>
          <div class="filename-group-label">FLAC tracks</div>
          <div class="filename-list">
            <Index each={plan().files}>
              {(file) => {
                const stateFile = () =>
                  props.state.files.apply.files.find((item) => item.id === file().id)
                return (
                  <div
                    class="filename-entry"
                    classList={{
                      'filename-entry-readonly': !props.state.files.apply.renameTrackFiles
                    }}
                  >
                    <div
                      class="filename-edit-row"
                      classList={{
                        'filename-edit-row-readonly': !props.state.files.apply.renameTrackFiles
                      }}
                    >
                      <span class="mono filename-current">{file().currentPath}</span>
                      <Show when={props.state.files.apply.renameTrackFiles}>
                        <span>→</span>
                        <div class="filename-target">
                          <Show when={file().targetPath.slice(0, -file().targetFilename.length)}>
                            <span class="mono filename-directory">
                              {file().targetPath.slice(0, -file().targetFilename.length)}
                            </span>
                          </Show>
                          <FixedExtensionInput
                            disabled={busy() || locked()}
                            extension=".flac"
                            value={withoutExtension(file().targetFilename, '.flac')}
                            onChange={(value) =>
                              void window.gravlax.upload.setFilenameOverride(
                                file().id,
                                withExtension(value, '.flac')
                              )
                            }
                            label={`Filename without the fixed FLAC extension for ${file().currentPath}`}
                          />
                        </div>
                        <IconButton
                          icon="refresh-cw"
                          label="Reset filename"
                          size="sm"
                          disabled={!stateFile()?.filenameOverride || busy() || locked()}
                          onClick={() => void window.gravlax.upload.setFilenameOverride(file().id)}
                        />
                      </Show>
                    </div>
                    <For each={pathErrors(file().currentPath, file().targetPath)}>
                      {(error) => <div class="filename-row-error">{error}</div>}
                    </For>
                  </div>
                )
              }}
            </Index>
          </div>
        </Show>

        <Show when={(plan().payloadFiles ?? []).some((file) => !file.track)}>
          <div class="filename-group-label">Other files</div>
          <div class="filename-list">
            <For each={(plan().payloadFiles ?? []).filter((file) => !file.track)}>
              {(file) => (
                <div
                  class="filename-entry"
                  classList={{
                    'filename-entry-readonly': !props.state.files.apply.renameTrackFiles
                  }}
                >
                  <div
                    class="filename-edit-row"
                    classList={{
                      'filename-edit-row-readonly': !props.state.files.apply.renameTrackFiles
                    }}
                  >
                    <span class="mono filename-current">{file.currentPath}</span>
                    <Show when={props.state.files.apply.renameTrackFiles}>
                      <span>→</span>
                      <div class="filename-target">
                        <Show when={file.targetPath.slice(0, -file.targetName.length)}>
                          <span class="mono filename-directory">
                            {file.targetPath.slice(0, -file.targetName.length)}
                          </span>
                        </Show>
                        <Show
                          when={filenameExtension(
                            payloadState(file.id)?.originalPath ?? file.currentPath
                          )}
                          fallback={
                            <input
                              class="mono filename-input"
                              disabled={busy() || locked()}
                              value={payloadState(file.id)?.nameOverride ?? file.targetName}
                              onChange={(event) => void window.gravlax.upload.setPayloadNameOverride(file.id, event.currentTarget.value)}
                              aria-label={`Filename for ${file.currentPath}`}
                            />
                          }
                        >
                          {(extension) => (
                            <FixedExtensionInput
                              disabled={busy() || locked()}
                              extension={extension()}
                              value={withoutExtension(file.targetName, extension())}
                              onChange={(value) =>
                                void window.gravlax.upload.setPayloadNameOverride(
                                  file.id,
                                  withExtension(value, extension())
                                )
                              }
                              label={`Filename without the fixed ${extension()} extension for ${file.currentPath}`}
                            />
                          )}
                        </Show>
                      </div>
                      <IconButton
                        icon="refresh-cw"
                        label="Reset filename"
                        size="sm"
                        disabled={!payloadState(file.id)?.nameOverride || busy() || locked()}
                        onClick={() => void window.gravlax.upload.setPayloadNameOverride(file.id)}
                      />
                    </Show>
                  </div>
                  <For each={pathErrors(file.currentPath, file.targetPath)}>
                    {(error) => <div class="filename-row-error">{error}</div>}
                  </For>
                </div>
              )}
            </For>
          </div>
        </Show>

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

function FixedExtensionInput(props: {
  disabled: boolean
  extension: string
  value: string
  onChange: (value: string) => void
  label: string
}) {
  return (
    <label class="filename-fixed-extension-field">
      <input
        class="mono filename-input"
        disabled={props.disabled}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        aria-label={props.label}
      />
      <span class="mono filename-extension" aria-hidden="true">{props.extension}</span>
    </label>
  )
}

function withoutExtension(filename: string, extension: string): string {
  return filename.toLocaleLowerCase().endsWith(extension.toLocaleLowerCase())
    ? filename.slice(0, -extension.length)
    : filename
}

function withExtension(stem: string, extension: string): string | undefined {
  return stem ? `${stem}${extension}` : undefined
}

function filenameExtension(filename: string): string {
  const index = filename.lastIndexOf('.')
  return index > 0 ? filename.slice(index) : ''
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
  onEditArtist: (action: ArtistEditAction) => void
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
        onEdit={props.onEditArtist}
        onCommit={props.onCommitEdit}
        onFieldBlur={props.onFieldBlur}
      />
    </Show>
  )
}
