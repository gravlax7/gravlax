export type CheckTone = 'success' | 'warning' | 'info'

export function fileNameOf(relativePath: string): string {
  return relativePath.includes('/')
    ? relativePath.slice(relativePath.lastIndexOf('/') + 1)
    : relativePath
}
