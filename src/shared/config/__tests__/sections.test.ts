import { describe, expect, it } from 'vitest'
import { CONFIG_SECTION_IDS } from '@shared/types/config'
import { THEME_PREFERENCES } from '@shared/theme'
import { UPLOAD_TRACKER_IDS } from '@shared/trackers'
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
    }
  })
})
