/** Progress shape shared by the SFTP transfer and the local seeding-folder copy. */
export interface TransferProgress {
  bytesTransferred: number
  bytesTotal: number
  filesTransferred: number
  filesTotal: number
  currentFile: string
}

export type TransferProgressCallback = (progress: TransferProgress) => void
