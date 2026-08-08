import { describe, expect, it } from 'vitest'
import { renderTemplate } from '../templateRender'

describe('renderTemplate', () => {
  it('interpolates variables', () => {
    expect(renderTemplate('Hello {{ name }}!', { name: 'World' })).toBe('Hello World!')
  })

  it('renders if blocks by truthiness', () => {
    expect(renderTemplate('{% if year %}{{ year }}{% endif %}', { year: 2020 })).toBe('2020')
    expect(renderTemplate('{% if year %}{{ year }}{% endif %}', { year: '' })).toBe('')
    expect(renderTemplate('{% if year %}{{ year }}{% endif %}', {})).toBe('')
  })

  it('supports nested if blocks', () => {
    const tpl =
      '{% if label %}Label: {{ label }}{% if catalog %} / {{ catalog }}{% endif %}\n{% endif %}'
    expect(renderTemplate(tpl, { label: 'Warp', catalog: 'WAP1' })).toBe('Label: Warp / WAP1\n')
    expect(renderTemplate(tpl, { label: 'Warp' })).toBe('Label: Warp\n')
    expect(renderTemplate(tpl, { catalog: 'WAP1' })).toBe('')
  })

  it('merges for-loop item keys into scope', () => {
    const tpl =
      '{% for track in tracks %}[b]{{ number }}.[/b] {{ title }}\n{% endfor %}'
    expect(
      renderTemplate(tpl, {
        tracks: [
          { number: '01', title: 'Intro' },
          { number: '02', title: 'Outro' }
        ]
      })
    ).toBe('[b]01.[/b] Intro\n[b]02.[/b] Outro\n')
  })

  it('renders peachfuzz-style content', () => {
    const tpl =
      '[b]{{ artist_bbcode }} - {{ album }}[/b]{% if year %}\n{{ year }}{% endif %}\n\n{% for track in tracks %}[b]{{ number }}.[/b] {{ title }}{% if duration %} [i]({{ duration }})[/i]{% endif %}\n{% endfor %}\n\nMore info: [url={{ source_url }}]{{ source }}[/url]'
    const out = renderTemplate(tpl, {
      artist_bbcode: '[artist]Alice[/artist]',
      album: 'Demo',
      year: '2024',
      tracks: [
        { number: '01', title: 'One', duration: '1:30' },
        { number: '02', title: 'Two (feat. [artist]Bob[/artist])', duration: '0:45' }
      ],
      source_url: 'https://example.com/x',
      source: 'Example'
    })
    expect(out).toContain('[b][artist]Alice[/artist] - Demo[/b]')
    expect(out).toContain('\n2024\n')
    expect(out).toContain('[b]01.[/b] One [i](1:30)[/i]')
    expect(out).toContain('[b]02.[/b] Two (feat. [artist]Bob[/artist]) [i](0:45)[/i]')
    expect(out).toContain('[url=https://example.com/x]Example[/url]')
  })
})
