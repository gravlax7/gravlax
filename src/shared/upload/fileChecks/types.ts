/** 'error' marks a rule break that blocks the upload. */
export type CheckTone = 'success' | 'warning' | 'info' | 'error'

export function fileNameOf(relativePath: string): string {
  return relativePath.includes('/')
    ? relativePath.slice(relativePath.lastIndexOf('/') + 1)
    : relativePath
}
