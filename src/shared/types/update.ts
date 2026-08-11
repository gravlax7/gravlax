export type UpdateCheckResult =
  | { status: 'disabled'; currentVersion: string }
  | { status: 'up-to-date'; currentVersion: string }
  | {
      status: 'available'
      currentVersion: string
      latestVersion: string
      releaseUrl: string
    }
  | { status: 'error'; currentVersion: string }
