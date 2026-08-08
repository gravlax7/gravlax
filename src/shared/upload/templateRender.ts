export type TemplateContext = Record<string, unknown>

function isTruthy(value: unknown): boolean {
  if (value == null) return false
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value)
  if (typeof value === 'string') return value.length > 0
  if (Array.isArray(value)) return value.length > 0
  return true
}

function resolve(path: string, ctx: TemplateContext): unknown {
  const parts = path.trim().split('.').filter(Boolean)
  if (parts.length === 0) return undefined
  let cur: unknown = ctx
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

function findNextOpen(src: string, from: number): number {
  const brace = src.indexOf('{{', from)
  const tag = src.indexOf('{%', from)
  if (brace < 0) return tag
  if (tag < 0) return brace
  return Math.min(brace, tag)
}

function takeBlock(
  src: string,
  start: number,
  openPrefix: string,
  closeName: string
): { body: string; next: number } {
  let depth = 1
  let i = start
  while (i < src.length) {
    const open = src.indexOf('{%', i)
    if (open < 0) {
      throw new Error(`unclosed {% ${openPrefix} %} block`)
    }
    const end = src.indexOf('%}', open)
    if (end < 0) {
      throw new Error(`unclosed tag at ${open}`)
    }
    const tag = src.slice(open + 2, end).trim()
    if (tag === openPrefix || tag.startsWith(`${openPrefix} `)) {
      depth += 1
      i = end + 2
      continue
    }
    if (tag === closeName) {
      depth -= 1
      if (depth === 0) {
        return { body: src.slice(start, open), next: end + 2 }
      }
      i = end + 2
      continue
    }
    i = end + 2
  }
  throw new Error(`unclosed {% ${openPrefix} %} block`)
}

function renderChunk(src: string, ctx: TemplateContext): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const open = findNextOpen(src, i)
    if (open < 0) {
      out += src.slice(i)
      break
    }
    out += src.slice(i, open)

    if (src.startsWith('{{', open)) {
      const end = src.indexOf('}}', open + 2)
      if (end < 0) {
        throw new Error(`unclosed {{ at ${open}`)
      }
      const expr = src.slice(open + 2, end).trim()
      const value = resolve(expr, ctx)
      out += value == null ? '' : String(value)
      i = end + 2
      continue
    }

    const end = src.indexOf('%}', open + 2)
    if (end < 0) {
      throw new Error(`unclosed {% at ${open}`)
    }
    const tag = src.slice(open + 2, end).trim()
    i = end + 2

    if (tag.startsWith('if ')) {
      const cond = tag.slice(3).trim()
      const block = takeBlock(src, i, 'if', 'endif')
      if (isTruthy(resolve(cond, ctx))) {
        out += renderChunk(block.body, ctx)
      }
      i = block.next
      continue
    }

    if (tag.startsWith('for ')) {
      const match = /^for\s+(\w+)\s+in\s+([\w.]+)$/.exec(tag)
      if (!match) {
        throw new Error(`invalid for tag: ${tag}`)
      }
      const itemName = match[1]!
      const listPath = match[2]!
      const block = takeBlock(src, i, 'for', 'endfor')
      const list = resolve(listPath, ctx)
      if (Array.isArray(list)) {
        for (const item of list) {
          const loopCtx: TemplateContext = { ...ctx, [itemName]: item }
          if (item && typeof item === 'object' && !Array.isArray(item)) {
            Object.assign(loopCtx, item as Record<string, unknown>)
          }
          out += renderChunk(block.body, loopCtx)
        }
      }
      i = block.next
      continue
    }

    if (tag === 'endif' || tag === 'endfor') {
      throw new Error(`unexpected {% ${tag} %}`)
    }
  }
  return out
}

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return renderChunk(template, ctx)
}
