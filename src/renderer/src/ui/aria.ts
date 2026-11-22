/** Solid 2 removes an attribute set to `false`, so `aria-*` states need the strings. */
export function ariaBool(value: boolean): 'true' | 'false' {
  return value ? 'true' : 'false'
}
