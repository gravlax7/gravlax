import sanitizeHtml from 'sanitize-html'
import { parse } from 'node-html-parser'
import type { Config, TrackerConfig } from '@shared/types/config'
import { createTrackers, type TrackerId } from './index'

const PREVIEW_TAGS = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'details',
  'div',
  'em',
  'hr',
  'img',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'summary',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'u',
  'ul'
]

const SAFE_COLOR = /^(?:#[0-9a-f]{3,8}|[a-z]+|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\))$/i
const SAFE_ALIGN = /^(?:left|right|center|justify)$/i

export async function previewBbcode(
  cfg: Config,
  source: string,
  signal?: AbortSignal
): Promise<string> {
  if (source === '') return ''

  const trackerId = previewTrackerId(cfg)
  const trackerConfig = cfg.trackers[trackerId]
  const trackerName = trackerId === 'redacted' ? 'Redacted' : 'Orpheus'
  validatePreviewConfig(trackerName, trackerConfig)

  const tracker = createTrackers(cfg).find((candidate) => candidate.id === trackerId)
  if (!tracker) throw new Error(`${trackerName} preview is unavailable.`)

  try {
    const html = await tracker.client.previewBbcode(source, signal)
    return sanitizeTrackerPreviewHtml(html, tracker.client.siteUrl)
  } catch (error) {
    const message = error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'request failed'
    throw new Error(`${trackerName} preview failed: ${message}`, {
      cause: error instanceof Error ? error : undefined
    })
  }
}

function previewTrackerId(cfg: Config): TrackerId {
  if (cfg.trackers.redacted.enabled) return 'redacted'
  if (cfg.trackers.orpheus.enabled) return 'orpheus'
  throw new Error('Enable Redacted or Orpheus to preview BBCode.')
}

function validatePreviewConfig(name: string, cfg: TrackerConfig): void {
  if (!cfg.siteUrl.trim()) throw new Error(`${name} preview requires a site URL.`)
  if (!cfg.apiKey.trim() && !cfg.sessionCookie.trim()) {
    throw new Error(`${name} preview requires an API key or session cookie.`)
  }
}

export function sanitizeTrackerPreviewHtml(html: string, siteUrl: string): string {
  const normalized = normalizeSpoilers(html)
  return sanitizeHtml(normalized, {
    allowedTags: PREVIEW_TAGS,
    allowedAttributes: {
      a: ['href', 'target', 'rel', 'title'],
      img: ['src', 'alt', 'title', 'loading', 'referrerpolicy'],
      '*': ['class', 'style']
    },
    allowedClasses: {
      '*': [/^size(?:10|[1-9])$/, 'quoteheader', 'postlist', 'scale_image']
    },
    allowedStyles: {
      '*': {
        color: [SAFE_COLOR],
        'font-style': [/^italic$/i],
        'text-align': [SAFE_ALIGN]
      }
    },
    allowedSchemes: ['http', 'https'],
    allowedSchemesByTag: {
      a: ['http', 'https'],
      img: ['https']
    },
    allowProtocolRelative: false,
    transformTags: {
      a: (_tagName, attributes) => {
        const href = safeUrl(attributes.href, siteUrl, ['http:', 'https:'])
        return {
          tagName: 'a',
          attribs: {
            ...(href ? { href, target: '_blank', rel: 'noreferrer noopener' } : {}),
            ...(attributes.title ? { title: attributes.title } : {})
          }
        }
      },
      img: (_tagName, attributes) => {
        const src = safeUrl(attributes.src, siteUrl, ['https:'])
        return {
          tagName: 'img',
          attribs: {
            ...(src ? { src } : {}),
            ...(attributes.alt ? { alt: attributes.alt } : {}),
            ...(attributes.title ? { title: attributes.title } : {}),
            loading: 'lazy',
            referrerpolicy: 'no-referrer',
            ...(attributes.class ? { class: attributes.class } : {})
          }
        }
      }
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !frame.attribs.src
  })
}

function safeUrl(value: string | undefined, baseUrl: string, protocols: string[]): string | null {
  if (!value) return null
  try {
    const parsed = new URL(value, `${baseUrl.replace(/\/+$/, '')}/`)
    return protocols.includes(parsed.protocol) ? parsed.toString() : null
  } catch {
    return null
  }
}

function normalizeSpoilers(html: string): string {
  const root = parse(html)
  const toggles = root
    .querySelectorAll('a')
    .filter((anchor) => /BBCode\.spoiler\s*\(/i.test(anchor.getAttribute('onclick') ?? ''))
    .reverse()

  for (const toggle of toggles) {
    const body = toggle.nextElementSibling
    if (body?.rawTagName !== 'blockquote' || !body.classNames.split(/\s+/).includes('spoiler')) {
      continue
    }

    const title = toggle.previousElementSibling?.rawTagName === 'strong'
      ? toggle.previousElementSibling
      : null
    const parent = toggle.parentNode
    if (!parent) continue

    const nodes = parent.childNodes
    const first = title ?? toggle
    const firstIndex = nodes.indexOf(first)
    const lastIndex = nodes.indexOf(body)
    if (firstIndex < 0 || lastIndex < firstIndex) continue

    const summary = title?.innerHTML.trim() || 'Hidden'
    const contents = body.innerHTML
    for (const node of nodes.slice(firstIndex + 1, lastIndex + 1)) node.remove()
    first.replaceWith(
      `<details><summary>${summary}</summary><blockquote>${contents}</blockquote></details>`
    )
  }

  return root.innerHTML
}
