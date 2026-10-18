import { Show } from 'solid-js'
import type { UploadSubmission } from '@shared/types'

/** Torrent link and lossy-report note for one tracker submission. */
export function SubmissionLinks(props: { submission: UploadSubmission }) {
  return (
    <>
      <Show when={props.submission.url}>
        {(url) => (
          <button
            type="button"
            class="upload-submission-link"
            onClick={() => void window.gravlax.shell.openExternal(url())}
          >
            Open torrent
          </button>
        )}
      </Show>
      <Show when={props.submission.lossyReport === 'failed'}>
        <span class="upload-submission-note">
          Torrent uploaded, but the lossy master report failed — file it by hand.
        </span>
      </Show>
    </>
  )
}
