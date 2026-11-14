import { Show } from 'solid-js'
import type { UploadSubmission } from '@shared/types'
import { lossyReportPhrase } from '@shared/upload/lossyReport'

/** Torrent link and lossy-report note for one tracker submission. */
export function SubmissionLinks(props: { submission: UploadSubmission; sourceMedia?: string }) {
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
          Torrent uploaded, but the {lossyReportPhrase(props.sourceMedia)} report failed — file it by hand.
        </span>
      </Show>
    </>
  )
}
