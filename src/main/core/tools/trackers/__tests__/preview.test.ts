import { afterEach, describe, expect, it, vi } from 'vitest'
import { defaultConfig } from '@main/core/config/defaults'
import type { Config } from '@shared/types/config'
import { resetTrackerRateLimiter } from '../gazelle'
import { previewBbcode, sanitizeTrackerPreviewHtml } from '../preview'

afterEach(() => {
  resetTrackerRateLimiter()
  vi.unstubAllGlobals()
})

function config(): Config {
  const cfg = defaultConfig()
  cfg.trackers.redacted = {
    ...cfg.trackers.redacted,
    enabled: true,
    siteUrl: 'https://redacted.example',
    announceUrl: 'https://announce.redacted.example',
    apiKey: 'redacted-key',
    sessionCookie: 'redacted-session'
  }
  cfg.trackers.orpheus = {
    ...cfg.trackers.orpheus,
    enabled: true,
    siteUrl: 'https://orpheus.example',
    announceUrl: 'https://announce.orpheus.example',
    apiKey: 'orpheus-key',
    sessionCookie: 'orpheus-session'
  }
  return cfg
}

function stubPreviewFetch(
  handler: (input: string, init?: RequestInit) => { status?: number; text: string }
): ReturnType<typeof vi.fn> {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const result = handler(input, init)
    return {
      status: result.status ?? 200,
      ok: (result.status ?? 200) >= 200 && (result.status ?? 200) < 300,
      url: input,
      text: async () => result.text,
      headers: { get: () => 'application/json', getSetCookie: () => [] }
    }
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}

describe('previewBbcode', () => {
  it('prefers enabled Redacted and returns sanitized HTML', async () => {
    const fetch = stubPreviewFetch(() => ({
      text: '<a href="artist.php?artistname=Artist" onclick="bad()">Artist</a>'
    }))

    await expect(previewBbcode(config(), '[artist]Artist[/artist]')).resolves.toBe(
      '<a href="https://redacted.example/artist.php?artistname=Artist" target="_blank" rel="noreferrer noopener">Artist</a>'
    )
    expect(String(fetch.mock.calls[0]?.[0])).toContain('https://redacted.example/ajax.php')
  })

  it('uses Orpheus only when Redacted is disabled', async () => {
    const cfg = config()
    cfg.trackers.redacted.enabled = false
    const fetch = stubPreviewFetch(() => ({ text: '<strong>OPS</strong>' }))

    await expect(previewBbcode(cfg, '[b]OPS[/b]')).resolves.toBe('<strong>OPS</strong>')
    expect(String(fetch.mock.calls[0]?.[0])).toContain('https://orpheus.example/ajax.php')
  })

  it('rejects missing configuration without sending a request', async () => {
    const cfg = config()
    cfg.trackers.redacted.siteUrl = ''
    const fetch = stubPreviewFetch(() => ({ text: '<strong>unused</strong>' }))

    await expect(previewBbcode(cfg, 'x')).rejects.toThrow(
      'Redacted preview requires a site URL.'
    )
    expect(fetch).not.toHaveBeenCalled()
  })

  it('requires one usable credential on the chosen tracker', async () => {
    const cfg = config()
    cfg.trackers.redacted.apiKey = ''
    cfg.trackers.redacted.sessionCookie = ''

    await expect(previewBbcode(cfg, 'x')).rejects.toThrow(
      'Redacted preview requires an API key or session cookie.'
    )
  })

  it('does not fall back after an enabled Redacted request fails', async () => {
    const fetch = stubPreviewFetch((input) => ({
      status: input.includes('redacted.example') ? 401 : 200,
      text: input.includes('redacted.example') ? '{"error":"invalid key"}' : '<b>OPS</b>'
    }))

    await expect(previewBbcode(config(), 'x')).rejects.toThrow('Redacted preview failed')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(String(fetch.mock.calls[0]?.[0])).toContain('redacted.example')
  })

  it('rejects a preview when no tracker is enabled', async () => {
    const cfg = config()
    cfg.trackers.redacted.enabled = false
    cfg.trackers.orpheus.enabled = false

    await expect(previewBbcode(cfg, 'x')).rejects.toThrow(
      'Enable Redacted or Orpheus to preview BBCode.'
    )
  })
})

describe('sanitizeTrackerPreviewHtml', () => {
  it('keeps formatting while removing active content and unsafe styles', () => {
    const html = sanitizeTrackerPreviewHtml(
      [
        '<span class="size1 other" style="color: #ff0000; position: fixed">small</span>',
        '<script>window.gravlax.upload.submitUpload()</script>',
        '<form action="https://bad.example"><input name="x"></form>'
      ].join(''),
      'https://redacted.example'
    )

    expect(html).toContain('<span class="size1" style="color:#ff0000">small</span>')
    expect(html).not.toContain('script')
    expect(html).not.toContain('position')
    expect(html).not.toContain('<form')
    expect(html).not.toContain('<input')
  })

  it('keeps the tracker HTML used for italics', () => {
    const html = sanitizeTrackerPreviewHtml(
      '<span style="font-style: italic; font-weight: bold">will be inserted at submit</span>',
      'https://redacted.example'
    )

    expect(html).toBe(
      '<span style="font-style:italic">will be inserted at submit</span>'
    )
    expect(html).not.toContain('font-weight')
  })

  it('preserves quote, code, list, and table structure', () => {
    const html = sanitizeTrackerPreviewHtml(
      [
        '<strong class="quoteheader">Alice</strong> wrote: <blockquote>quoted</blockquote>',
        '<code><pre>const x = 1;</pre></code>',
        '<ul class="postlist"><li>one</li></ul>',
        '<table><thead><tr><th>Name</th></tr></thead><tbody><tr><td>Album</td></tr></tbody></table>'
      ].join(''),
      'https://redacted.example'
    )

    expect(html).toContain('<strong class="quoteheader">Alice</strong>')
    expect(html).toContain('<blockquote>quoted</blockquote>')
    expect(html).toContain('<code><pre>const x = 1;</pre></code>')
    expect(html).toContain('<ul class="postlist"><li>one</li></ul>')
    expect(html).toContain('<table><thead><tr><th>Name</th></tr></thead>')
  })

  it('converts tracker spoilers into safe details blocks', () => {
    const html = sanitizeTrackerPreviewHtml(
      '<strong>Details</strong>: <a href="javascript:void(0)" onclick="BBCode.spoiler(this);">Show</a><blockquote class="hidden spoiler"><em>Body</em></blockquote>',
      'https://redacted.example'
    )

    expect(html).toBe(
      '<details><summary>Details</summary><blockquote><em>Body</em></blockquote></details>'
    )
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('javascript:')
  })

  it('resolves links and permits only safe preview images', () => {
    const html = sanitizeTrackerPreviewHtml(
      [
        '<a href="artist.php?artistname=Artist">Artist</a>',
        '<a href="javascript:alert(1)">Bad link</a>',
        '<img class="scale_image" onclick="bad()" data-origin-src="https://origin.example/x.jpg" src="https://images.example/x.jpg" alt="Cover">',
        '<img src="http://images.example/insecure.jpg">'
      ].join(''),
      'https://redacted.example'
    )

    expect(html).toContain(
      '<a href="https://redacted.example/artist.php?artistname=Artist" target="_blank" rel="noreferrer noopener">Artist</a>'
    )
    expect(html).toContain('<a>Bad link</a>')
    expect(html).toContain(
      '<img src="https://images.example/x.jpg" alt="Cover" loading="lazy" referrerpolicy="no-referrer" class="scale_image" />'
    )
    expect(html).not.toContain('insecure.jpg')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('data-origin-src')
  })
})
