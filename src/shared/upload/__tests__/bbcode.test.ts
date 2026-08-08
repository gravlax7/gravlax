import { describe, expect, it } from 'vitest'
import { bbcodeToHtml } from '../bbcode'

describe('bbcodeToHtml', () => {
  it('escapes html then renders common tags', () => {
    const html = bbcodeToHtml('[b]Hello <world>[/b]\n[url=https://example.com]link[/url]')
    expect(html).toContain('<strong>Hello &lt;world&gt;</strong>')
    expect(html).toContain('<br />')
    expect(html).toContain(
      '<a href="https://example.com" target="_blank" rel="noreferrer noopener">link</a>'
    )
  })

  it('renders hide blocks as details', () => {
    expect(bbcodeToHtml('[hide=Spectrals]\nbody\n[/hide]')).toContain(
      '<details><summary>Spectrals</summary>'
    )
  })
})
