import { describe, expect, it } from 'vitest'
import {
  ARTIST_IMPORTANCE,
  artistRoleToImportance,
  importanceToArtistRole,
  isNamedMainArtist
} from '../artists'

describe('artistRoleToImportance', () => {
  it('maps roles to Gazelle importance', () => {
    expect(artistRoleToImportance('main')).toBe(1)
    expect(artistRoleToImportance('dj/compiler')).toBe(6)
    expect(artistRoleToImportance('arranger')).toBe(8)
  })

  it('normalizes case and whitespace', () => {
    expect(artistRoleToImportance('  Remixer ')).toBe(3)
  })

  it('falls back to main for unknown and empty roles', () => {
    expect(artistRoleToImportance('backing vocals')).toBe(1)
    expect(artistRoleToImportance('')).toBe(1)
    expect(artistRoleToImportance(undefined)).toBe(1)
  })
})

describe('importanceToArtistRole', () => {
  it('inverts every role in the table', () => {
    for (const [role, importance] of Object.entries(ARTIST_IMPORTANCE)) {
      expect(importanceToArtistRole(importance)).toBe(role)
    }
  })

  it('falls back to main for an unknown importance', () => {
    expect(importanceToArtistRole(99)).toBe('main')
  })
})

describe('isNamedMainArtist', () => {
  it('needs both importance 1 and a name', () => {
    expect(isNamedMainArtist({ name: 'A', importance: 1 })).toBe(true)
    expect(isNamedMainArtist({ name: '  ', importance: 1 })).toBe(false)
    expect(isNamedMainArtist({ name: 'A', importance: 2 })).toBe(false)
  })
})
