import { describe, expect, it } from 'vitest'
import { normalizeProviderArtistRole } from '../normalization'

describe('normalizeProviderArtistRole', () => {
  it.each(['', 'main', 'primary'])('maps %j to main', (role) => {
    expect(normalizeProviderArtistRole(role)).toBe('main')
  })

  it.each(['featured', 'featuring', 'feat', 'ft', 'ft.'])('maps %s to guest', (role) => {
    expect(normalizeProviderArtistRole(role)).toBe('guest')
  })

  it('uses the shared artist-role cleanup for other roles', () => {
    expect(normalizeProviderArtistRole('  Remixer  ')).toBe('remixer')
  })
})
