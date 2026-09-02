import { describe, expect, it } from 'vitest'
import { CONFIG_SECTION_IDS } from '@shared/types/config'
import { THEME_PREFERENCES } from '@shared/theme'
import { UPLOAD_TRACKER_IDS, trackerName } from '@shared/trackers'
import { SPECTRAL_SELECTION_OPTIONS } from '@shared/upload/spectralIds'
import { sections } from '../sections'

describe('settings sections', () => {
  it('covers every config section once', () => {
    const ids = sections().map((section) => section.id)
    expect(new Set(ids)).toEqual(new Set(CONFIG_SECTION_IDS))
    expect(ids).toHaveLength(CONFIG_SECTION_IDS.length)
  })

  it('uses shared theme and spectral choices', () => {
    const byId = new Map(sections().map((section) => [section.id, section]))
    expect(byId.get('appearance')?.fields.find((field) => field.name === 'theme')?.options).toEqual(
      [...THEME_PREFERENCES]
    )
    for (const name of ['defaultSpectralIds', 'defaultSpectralIdsForLossy']) {
      expect(byId.get('spectral')?.fields.find((field) => field.name === name)?.options).toEqual([
        ...SPECTRAL_SELECTION_OPTIONS
      ])
    }
  })

  it('explains and masks qBittorrent API key authentication', () => {
    const fields = sections().find((section) => section.id === 'torrentClient')?.fields ?? []
    expect(fields.map((field) => field.name)).toEqual([
      'enabled',
      'url',
      'allowInsecureHTTP',
      'separator',
      'username',
      'password',
      'useApiKey',
      'apiKey',
      'separator',
      'category',
      'useAutoTMM',
      'savePath',
      'startPaused'
    ])
    expect(fields.find((field) => field.name === 'useApiKey')?.description).toBe(
      'Generate one in qBittorrent Settings → Web UI → API Key; API key authentication is recommended for qBittorrent 5.2 and newer.'
    )
    expect(fields.find((field) => field.name === 'apiKey')).toMatchObject({
      label: 'API key',
      type: 'string',
      sensitive: true
    })
  })

  it('builds the same settings fields for every tracker', () => {
    const fields = sections().find((section) => section.id === 'trackers')?.fields ?? []
    for (const id of UPLOAD_TRACKER_IDS) {
      const names = fields
        .filter((field) => field.name.startsWith(`${id}.`))
        .map((field) => field.name)
      expect(names).toEqual([
        `${id}.enabled`,
        `${id}.siteUrl`,
        `${id}.announceUrl`,
        `${id}.apiKey`,
        `${id}.sessionCookie`,
        `${id}.coverImageHost`
      ])
      const site = fields.find((field) => field.name === `${id}.siteUrl`)
      const announce = fields.find((field) => field.name === `${id}.announceUrl`)
      expect(site).toMatchObject({ type: 'host', label: `${trackerName(id)} site host` })
      expect(announce).toMatchObject({
        type: 'host',
        label: `${trackerName(id)} announce host`
      })
    }
  })
})
