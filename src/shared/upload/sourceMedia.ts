export const SOURCE_MEDIA_OPTIONS = ['WEB', 'CD', 'Vinyl'] as const

export type SourceMedia = (typeof SOURCE_MEDIA_OPTIONS)[number]
