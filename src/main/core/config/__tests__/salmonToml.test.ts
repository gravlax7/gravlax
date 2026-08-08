import { describe, expect, it } from 'vitest'
import { parseSalmonToml } from '@main/core/config/salmonToml'

describe('parseSalmonToml', () => {
  it('parses tables, arrays of tables and typed scalars', () => {
    const result = parseSalmonToml(
      [
        '[directory]',
        "download_directory = '/srv/music'",
        '',
        '[tracker.red]',
        "session = 'cookie'",
        '',
        '[[seedbox]]',
        'enabled = true',
        'type = "rclone"',
        'url = "nas"'
      ].join('\n')
    )

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data).toMatchObject({
      directory: { download_directory: '/srv/music' },
      tracker: { red: { session: 'cookie' } },
      seedbox: [{ enabled: true, type: 'rclone', url: 'nas' }]
    })
  })

  it('reports malformed TOML rather than throwing', () => {
    const result = parseSalmonToml('[directory\ndownload_directory =')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('Could not read the TOML file')
  })

  it('accepts an empty file', () => {
    expect(parseSalmonToml('')).toEqual({ ok: true, data: {} })
  })
})
