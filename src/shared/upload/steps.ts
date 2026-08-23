export const WORKFLOW_STEPS = [
  { id: 'files-check', title: 'Files Check', body: '' },
  {
    id: 'spectrals',
    title: 'Spectrals',
    body: 'Review generated spectrals and decide whether the upload should be reported as lossy master.'
  },
  { id: 'metadata', title: 'Metadata', body: '' },
  { id: 'tags', title: 'Tags & Filenames', body: '' },
  {
    id: 'transcode',
    title: 'Transcode',
    body: 'Prepare any downconversion work needed before upload.'
  },
  {
    id: 'upload',
    title: 'Upload',
    body: 'Review the final payload and submit it to the target tracker.'
  },
  {
    id: 'seed',
    title: 'Seed',
    body: 'Hand the finished torrent to the chosen client or remote target.'
  }
] as const

export type WorkflowStep = (typeof WORKFLOW_STEPS)[number]
export type StepID = WorkflowStep['id']

export interface Step {
  id: StepID
  title: string
  body: string
}
