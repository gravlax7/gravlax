export const SOURCE_MEDIA_OPTIONS = ['WEB', 'CD'] as const

export type SourceMedia = (typeof SOURCE_MEDIA_OPTIONS)[number]
