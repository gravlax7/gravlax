const DATE_SHAPE = /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/

export function isValidDateShape(value: string): boolean {
  const trimmed = value.trim()
  return trimmed === '' || DATE_SHAPE.test(trimmed)
}

export function dateYear(value: string | undefined): string {
  const match = /(\d{4})/.exec((value ?? '').trim())
  return match?.[1] ?? ''
}

export function metadataDate(value: string | undefined): string {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return ''
  if (DATE_SHAPE.test(trimmed)) return trimmed
  const prefix = /^(\d{4}(?:-\d{2}(?:-\d{2})?)?)/.exec(trimmed)
  if (prefix?.[1] && DATE_SHAPE.test(prefix[1])) return prefix[1]
  return dateYear(trimmed)
}

export function invalidReleaseDateFields(
  groupYear: string | undefined,
  year: string | undefined
): string[] {
  const invalid: string[] = []
  if (!isValidDateShape(groupYear ?? '')) invalid.push('groupYear')
  if (!isValidDateShape(year ?? '')) invalid.push('year')
  return invalid
}
