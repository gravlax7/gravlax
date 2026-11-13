/**
 * Formats a comma-separated tag list the way trackers expect: lowercase, with
 * spaces inside a tag swapped for dots (`Chamber Music` -> `chamber.music`).
 * Trackers strip spaces, so leaving them in would upload `chambermusic`.
 */
export function formatTrackerTags(tags: readonly string[]): string {
  return tags
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, '.'))
    .filter(Boolean)
    .join(', ')
}

export function normalizeTrackerTags(raw: string): string {
  return formatTrackerTags(raw.split(','))
}
