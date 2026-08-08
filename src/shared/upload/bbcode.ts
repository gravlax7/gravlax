function sanitizeHref(href: string): string | null {
  const trimmed = href.trim()
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  return null
}

function replacePaired(
  input: string,
  open: RegExp,
  close: string,
  wrap: (inner: string, openMatch: RegExpExecArray) => string
): string {
  let out = ''
  let i = 0
  const closeLower = close.toLowerCase()
  while (i < input.length) {
    open.lastIndex = 0
    const slice = input.slice(i)
    const match = open.exec(slice)
    if (!match || match.index == null) {
      out += input.slice(i)
      break
    }
    out += input.slice(i, i + match.index)
    const contentStart = i + match.index + match[0].length
    const closeAt = input.toLowerCase().indexOf(closeLower, contentStart)
    if (closeAt < 0) {
      out += match[0]
      i = contentStart
      continue
    }
    const inner = input.slice(contentStart, closeAt)
    out += wrap(inner, match)
    i = closeAt + close.length
  }
  return out
}

export function bbcodeToHtml(source: string): string {
  let html = escapeHtml(source)

  html = html.replace(/\[hr\]/gi, '<hr />')

  html = replacePaired(html, /\[b\]/i, '[/b]', (inner) => `<strong>${inner}</strong>`)
  html = replacePaired(html, /\[i\]/i, '[/i]', (inner) => `<em>${inner}</em>`)
  html = replacePaired(html, /\[u\]/i, '[/u]', (inner) => `<u>${inner}</u>`)
  html = replacePaired(
    html,
    /\[url=([^\]]+)\]/i,
    '[/url]',
    (inner, match) => {
      const href = sanitizeHref(match[1] ?? '')
      if (!href) return inner
      return `<a href="${href}" target="_blank" rel="noreferrer noopener">${inner}</a>`
    }
  )
  html = replacePaired(html, /\[url\]/i, '[/url]', (inner) => {
    const href = sanitizeHref(inner)
    if (!href) return inner
    return `<a href="${href}" target="_blank" rel="noreferrer noopener">${inner}</a>`
  })
  html = replacePaired(
    html,
    /\[size=([^\]]+)\]/i,
    '[/size]',
    (inner, match) => {
      const size = (match[1] ?? '').trim()
      if (!/^\d+(?:\.\d+)?$/.test(size)) return inner
      return `<span style="font-size:${size}em">${inner}</span>`
    }
  )
  html = replacePaired(
    html,
    /\[color=([^\]]+)\]/i,
    '[/color]',
    (inner, match) => {
      const color = (match[1] ?? '').trim()
      if (!/^#[0-9a-fA-F]{3,8}$|^[a-zA-Z]+$/.test(color)) return inner
      return `<span style="color:${color}">${inner}</span>`
    }
  )
  html = replacePaired(
    html,
    /\[hide(?:=([^\]]+))?\]/i,
    '[/hide]',
    (inner, match) => {
      const title = (match[1] ?? 'Hidden').trim() || 'Hidden'
      return `<details><summary>${title}</summary>${inner}</details>`
    }
  )
  html = replacePaired(html, /\[artist\]/i, '[/artist]', (inner) => `<span class="bbcode-artist">${inner}</span>`)

  return html.replace(/\n/g, '<br />')
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

