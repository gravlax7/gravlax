import { Show, createEffect, createMemo, createSignal, onCleanup, onMount } from 'solid-js'
import type { Config } from '@shared/types/config'
import type {
  Artist,
  HealthResult,
  MetadataSelection,
  UploadFlowStateJSON
} from '@shared/types'
import {
  FIELD_ARTISTS,
  DEFAULT_ARTIST_ROLE
} from '@shared/types/upload'
import {
  editorTrackValue,
  editorValue,
  fieldEditable,
  formatArtists,
  hasNamedMainArtist,
  normalizeArtistRole,
  setFieldEditorValue,
  setTrackFieldEditorValue
} from '@shared/tags/editor'
import {
  UPLOAD_STEPS,
  canNavigateToStep,
  isTranscodeBusy
} from '@shared/upload/stepGating'
import { Modal } from '../../components/Modal'
import { Button, Icon, ProgressBar } from '../../ui'
import { basename } from './pathUtil'
import { Lightbox } from './Lightbox'
import { Stepper } from './Stepper'
import { FilesCheckStep } from './steps/FilesCheckStep'
import { MetadataStep } from './steps/MetadataStep'
import { SeedStep } from './steps/SeedStep'
import { SpectralsStep } from './steps/SpectralsStep'
import { TagsStep } from './steps/TagsStep'
import { TranscodeStep } from './steps/TranscodeStep'
import { UploadStep, UploadSubmitAction } from './steps/UploadStep'

function sameMetadataSelection(
  current: MetadataSelection | null | undefined,
  next: MetadataSelection
): boolean {
  if (!current) return false
  return (
    current.provider === next.provider &&
    (current.releaseId ?? '') === (next.releaseId ?? '') &&
    (current.url ?? '') === (next.url ?? '')
  )
}

export function UploadScreen(props: {
  state: UploadFlowStateJSON
  config: Config
  health: HealthResult | null
  healthLoading: boolean
  onExit: () => void
}) {
  const [spectrals, setSpectrals] = createSignal<
    Array<{ full: string; zoom: string; index: number; filename: string }>
  >([])
  const [lightboxIndex, setLightboxIndex] = createSignal<number | null>(null)
  const [editingField, setEditingField] = createSignal<string | null>(null)
  const [editingTrackIndex, setEditingTrackIndex] = createSignal<number | null>(null)
  const [editValue, setEditValue] = createSignal('')
  const [editArtists, setEditArtists] = createSignal<Artist[]>([])
  const [pendingMetadataSelection, setPendingMetadataSelection] =
    createSignal<MetadataSelection | null>(null)
  const [pendingWriteStep, setPendingWriteStep] = createSignal<number | null>(null)
  const [submitRequestActive, setSubmitRequestActive] = createSignal(false)
  const [submitErrorAwaited, setSubmitErrorAwaited] = createSignal<string | null>(null)
  let uploadAtSubmit = props.state.upload

  const stepIndex = () => props.state.currentStep
  const stepId = () => UPLOAD_STEPS[stepIndex()]?.id
  const tagsStepIndex = UPLOAD_STEPS.findIndex((step) => step.id === 'tags')

  createEffect(() => {
    const error = submitErrorAwaited()
    // The IPC reply can arrive before the throttled state event. Keep the busy
    // UI in place until the matching failure reaches the renderer.
    if (
      error &&
      props.state.upload !== uploadAtSubmit &&
      props.state.upload.error === error
    ) {
      setSubmitErrorAwaited(null)
      setSubmitRequestActive(false)
    }
  })

  const title = createMemo(() =>
    props.state.draft.sourcePath ? basename(props.state.draft.sourcePath) : 'Uploader'
  )

  const lightboxImages = createMemo(() =>
    spectrals().flatMap((pair) => [
      { src: pair.full, label: pair.filename },
      { src: pair.zoom, label: `${pair.filename} (zoom)` }
    ])
  )

  const navigateToStep = (index: number): void => {
    if (!canNavigateToStep(index, props.state)) return
    void window.gravlax.upload.setCurrentStep(index).then((result) => {
      if (!result.ok && result.needsConfirmation) setPendingWriteStep(index)
    })
  }

  const submitUpload = (): void => {
    if (submitRequestActive()) return
    uploadAtSubmit = props.state.upload
    setSubmitErrorAwaited(null)
    setSubmitRequestActive(true)
    void window.gravlax.upload.submitUpload().then(
      (result) => {
        if (result.ok) setSubmitRequestActive(false)
        else setSubmitErrorAwaited(result.error)
      },
      () => {
        setSubmitErrorAwaited(null)
        setSubmitRequestActive(false)
      }
    )
  }

  const selectMetadataAndOpenTags = (selection: MetadataSelection): void => {
    void window.gravlax.upload.selectMetadataMatch(selection).then(() => {
      if (tagsStepIndex >= 0) navigateToStep(tagsStepIndex)
    })
  }

  const requestMetadataSelection = (selection: MetadataSelection): void => {
    if (sameMetadataSelection(props.state.metadata.selected, selection)) {
      if (tagsStepIndex >= 0) navigateToStep(tagsStepIndex)
      return
    }
    if (props.state.tags.proposedDirty) {
      setPendingMetadataSelection(selection)
      return
    }
    selectMetadataAndOpenTags(selection)
  }

  const startFieldEdit = (field: string, trackIndex?: number): void => {
    if (trackIndex == null && !fieldEditable(field)) return
    setEditingField(field)
    setEditingTrackIndex(trackIndex ?? null)
    if (field === FIELD_ARTISTS) {
      const artists =
        trackIndex == null
          ? (props.state.tags.proposed?.artists ?? [])
          : (props.state.tags.proposed?.tracks?.[trackIndex]?.artists ?? [])
      setEditArtists(
        artists.length > 0
          ? artists.map((artist) => ({
              name: artist.name ?? '',
              role: normalizeArtistRole(artist.role ?? '')
            }))
          : [{ name: '', role: DEFAULT_ARTIST_ROLE }]
      )
      return
    }
    if (trackIndex == null) {
      setEditValue(editorValue(props.state.tags.proposed ?? {}, field))
      return
    }
    setEditValue(editorTrackValue(props.state.tags.proposed?.tracks?.[trackIndex], field))
  }

  const cancelFieldEdit = (): void => {
    setEditingField(null)
    setEditingTrackIndex(null)
  }

  let suppressFieldBlur = false

  const commitFieldEdit = (suppressBlur = true): void => {
    const field = editingField()
    if (!field) return
    if (field === FIELD_ARTISTS && !hasNamedMainArtist(editArtists())) return
    suppressFieldBlur = suppressBlur
    const trackIndex = editingTrackIndex()
    const artistsValue = formatArtists(editArtists()).join('\n')
    const next =
      trackIndex == null
        ? field === FIELD_ARTISTS
          ? setFieldEditorValue(props.state.tags.proposed ?? {}, field, artistsValue)
          : setFieldEditorValue(props.state.tags.proposed ?? {}, field, editValue())
        : field === FIELD_ARTISTS
          ? setTrackFieldEditorValue(props.state.tags.proposed ?? {}, trackIndex, field, artistsValue)
          : setTrackFieldEditorValue(
              props.state.tags.proposed ?? {},
              trackIndex,
              field,
              editValue()
            )
    void window.gravlax.upload.updateTagsProposed(next)
    setEditingField(null)
    setEditingTrackIndex(null)
  }

  const onFieldBlur = (): void => {
    if (suppressFieldBlur) {
      suppressFieldBlur = false
      return
    }
    commitFieldEdit(false)
  }

  const focusFieldEditor = (el: HTMLInputElement | HTMLTextAreaElement): void => {
    queueMicrotask(() => {
      el.focus()
      el.select()
    })
  }

  const transcodeHardBlocked = (): boolean =>
    (props.state.transcode?.inspection?.blockers ?? []).some(
      (b) => b.kind === 'lossy' || b.kind === 'empty'
    )

  const filesCheckTask = () => props.state.background.tasks.find((t) => t.id === 'files-check')
  const filesCheckBusy = (): boolean => {
    const status = filesCheckTask()?.status
    return status === 'running' || status === 'queued'
  }

  const actionLabel = (): { back: string; mid: string; continue: string; midVariant: 'secondary' | 'danger' } => {
    const id = stepId()
    if (id === 'files-check') {
      if (!filesCheckTask()) {
        return { back: 'Back', mid: '', continue: 'Continue', midVariant: 'secondary' }
      }
      return {
        back: 'Back',
        mid: filesCheckTask()?.status === 'failed' ? 'Retry' : 'Re-check',
        continue: 'Continue',
        midVariant: 'secondary'
      }
    }
    if (id === 'spectrals')
      return { back: 'Back', mid: 'Regenerate', continue: 'Continue', midVariant: 'secondary' }
    if (id === 'metadata')
      return { back: 'Back', mid: 'Refresh', continue: 'Continue', midVariant: 'secondary' }
    if (id === 'tags')
      return {
        back: 'Back',
        mid: 'Discard edits & reload',
        continue: props.state.files.apply.phase === 'applying'
          ? 'Applying…'
          : props.state.files.apply.phase === 'applied' ? 'Continue' : 'Apply & continue',
        midVariant: 'danger'
      }
    if (id === 'transcode') {
      const phase = props.state.transcode?.phase
      if (phase === 'running')
        return { back: 'Back', mid: '', continue: 'Continue', midVariant: 'secondary' }
      if (phase === 'ready' || phase === 'done' || phase === 'failed') {
        const selected = props.state.transcode?.selectedOptionIds?.length ?? 0
        return {
          back: 'Back',
          mid: selected > 0 ? 'Generate' : 'Refresh',
          continue: 'Continue',
          midVariant: 'secondary'
        }
      }
      return { back: 'Back', mid: 'Refresh', continue: 'Continue', midVariant: 'secondary' }
    }
    if (id === 'seed')
      return { back: 'Back', mid: '', continue: 'Finish', midVariant: 'secondary' }
    return { back: 'Back', mid: '', continue: 'Continue', midVariant: 'secondary' }
  }

  const runMidAction = (): void => {
    const id = stepId()
    if (id === 'files-check') void window.gravlax.upload.refreshFilesCheck()
    if (id === 'spectrals') void window.gravlax.upload.regenerateSpectrals()
    if (id === 'metadata') void window.gravlax.upload.refreshMetadata()
    if (id === 'tags') {
      cancelFieldEdit()
      void window.gravlax.upload.refreshTags()
    }
    if (id === 'transcode') {
      if (actionLabel().mid === 'Generate') {
        void window.gravlax.upload.runTranscode()
      } else {
        void window.gravlax.upload.refreshTranscode()
      }
    }
  }

  onMount(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (lightboxIndex() !== null) return
      if (editingField() && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        cancelFieldEdit()
      }
    }
    window.addEventListener('keydown', onKey, true)
    onCleanup(() => window.removeEventListener('keydown', onKey, true))
  })

  createEffect(() => {
    const workspacePath = props.state.draft.workspacePath
    const spectralsTask = props.state.background.tasks.find((t) => t.id === 'spectrals')
    const spectralsStatus = spectralsTask?.status
    if (workspacePath && (spectralsStatus === 'succeeded' || spectralsStatus === undefined)) {
      void window.gravlax.upload.listSpectrals().then(setSpectrals)
    } else if (!workspacePath) {
      setSpectrals([])
    }
  })

  createEffect(() => {
    if (stepId() !== 'tags' && editingField()) cancelFieldEdit()
  })

  return (
    <div class="upload-screen">
      <header class="upload-header">
        <div class="upload-title">{title()}</div>
        <Stepper state={props.state} onNavigate={navigateToStep} />
      </header>

      <div class="upload-body">
        <div class="content-frame">
          <Show when={stepId() === 'files-check'}>
            <FilesCheckStep state={props.state} />
          </Show>
          <Show when={stepId() === 'spectrals'}>
            <SpectralsStep
              state={props.state}
              spectrals={spectrals()}
              onOpenLightbox={setLightboxIndex}
            />
          </Show>
          <Show when={stepId() === 'metadata'}>
            <MetadataStep state={props.state} onSelect={requestMetadataSelection} />
          </Show>
          <Show when={stepId() === 'tags'}>
            <TagsStep
              state={props.state}
              config={props.config}
              editingField={editingField()}
              editingTrackIndex={editingTrackIndex()}
              editValue={editValue()}
              editArtists={editArtists()}
              onStartEdit={startFieldEdit}
              onCancelEdit={cancelFieldEdit}
              onCommitEdit={commitFieldEdit}
              onEditValueChange={setEditValue}
              onEditArtistsChange={setEditArtists}
              onFieldBlur={onFieldBlur}
              focusFieldEditor={focusFieldEditor}
              onReload={() => {
                cancelFieldEdit()
                void window.gravlax.upload.refreshTags()
              }}
            />
          </Show>
          <Show when={stepId() === 'transcode'}>
            <TranscodeStep state={props.state} />
          </Show>
          <Show when={stepId() === 'upload'}>
            <UploadStep
              state={props.state}
              config={props.config}
              health={props.health}
              healthLoading={props.healthLoading}
              submitRequestActive={submitRequestActive()}
            />
          </Show>
          <Show when={stepId() === 'seed'}>
            <SeedStep
              state={props.state}
              config={props.config}
              onRetry={() => void window.gravlax.upload.startSeed()}
            />
          </Show>
        </div>
      </div>

      <Show when={
        stepId() === 'tags' &&
        props.state.files.apply.phase === 'applying' &&
        (props.state.files.apply.progressTotal ?? 0) > 0
      }>
        <div class="upload-file-progress" role="status" aria-live="polite">
          <div class="upload-file-progress-label">
            <strong>Applying tags and filenames</strong>
            <Show when={props.state.files.apply.progressLabel}>
              {(label) => <span> — {label()}</span>}
            </Show>
          </div>
          <span class="upload-file-progress-count">
            {props.state.files.apply.progressCurrent ?? 0}/{props.state.files.apply.progressTotal}
          </span>
          <ProgressBar
            class="upload-file-progress-bar"
            value={props.state.files.apply.progressCurrent ?? 0}
            max={props.state.files.apply.progressTotal}
            tone="accent"
            label="Tag and filename progress"
          />
        </div>
      </Show>

      <footer class="upload-footer">
        <Button
          variant="ghost"
          onClick={() => {
            if (stepIndex() === 0) props.onExit()
            else navigateToStep(stepIndex() - 1)
          }}
        >
          {actionLabel().back}
        </Button>
        <div class="upload-footer-spacer" />
        <Show when={actionLabel().mid}>
          <Button
            variant={actionLabel().midVariant}
            disabled={
              (stepId() === 'files-check' && filesCheckBusy()) ||
              (stepId() === 'transcode' &&
                (isTranscodeBusy(props.state.transcode) ||
                  (actionLabel().mid === 'Generate' && transcodeHardBlocked())))
            }
            onClick={runMidAction}
          >
            <Show when={stepId() === 'spectrals'}>
              <Icon name="refresh-cw" size={14} />
            </Show>
            {actionLabel().mid}
          </Button>
        </Show>
        <Show
          when={stepId() === 'upload'}
          fallback={
            <Button
              variant="primary"
              loading={stepId() === 'tags' && props.state.files.apply.phase === 'applying'}
              disabled={
                (stepId() === 'seed' && props.state.seed.phase !== 'done') ||
                (stepId() === 'transcode' && props.state.transcode?.phase === 'inspecting') ||
                (stepId() === 'tags' &&
                  (props.state.tags.releaseStatus === 'loading' ||
                    props.state.files.apply.phase === 'applying' ||
                    props.state.files.apply.phase === 'restoring'))
              }
              onClick={() => {
                if (stepId() === 'seed') {
                  void window.gravlax.upload.finish().then((result) => {
                    if (result.ok) props.onExit()
                  })
                  return
                }
                navigateToStep(Math.min(UPLOAD_STEPS.length - 1, stepIndex() + 1))
              }}
            >
              {actionLabel().continue}
              <Icon name={stepId() === 'seed' ? 'check' : 'chevron-right'} size={14} />
            </Button>
          }
        >
          <UploadSubmitAction
            state={props.state}
            config={props.config}
            health={props.health}
            healthLoading={props.healthLoading}
            submitRequestActive={submitRequestActive()}
            onSubmit={submitUpload}
          />
        </Show>
      </footer>

      <Show when={lightboxIndex() !== null}>
        <Lightbox
          images={lightboxImages()}
          index={lightboxIndex()!}
          onClose={() => setLightboxIndex(null)}
          onChangeIndex={setLightboxIndex}
        />
      </Show>

      <Show when={pendingMetadataSelection()}>
        <Modal
          title="Selecting another release will discard your tag edits. Continue?"
          options={['Discard edits', 'Cancel']}
          defaultIndex={1}
          onChoose={(index) => {
            const next = pendingMetadataSelection()
            setPendingMetadataSelection(null)
            if (index === 0 && next) {
              selectMetadataAndOpenTags(next)
            }
          }}
        />
      </Show>

      <Show when={pendingWriteStep() !== null}>
        <Modal
          title="Apply tags and rename files on disk?"
          options={['Apply & continue', 'Cancel']}
          defaultIndex={1}
          onChoose={(index) => {
            const target = pendingWriteStep()
            setPendingWriteStep(null)
            if (index === 0 && target !== null) {
              void window.gravlax.upload.setCurrentStepConfirmed(target)
            }
          }}
        />
      </Show>
    </div>
  )
}
