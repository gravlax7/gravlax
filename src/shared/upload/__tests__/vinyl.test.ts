import { describe, expect, it } from 'vitest'
import {
  lineageFilePath,
  metadataMediaMismatch,
  validateVinylLineage,
  vinylTrackCountNotice
} from '../vinyl'

describe('validateVinylLineage', () => {
  it('asks for a decision only on an undecided vinyl rip', () => {
    expect(validateVinylLineage({ sourceMedia: 'Vinyl' })).toBe(
      'Choose the lineage for this vinyl rip, or confirm uploading without one.'
    )
    expect(validateVinylLineage({ sourceMedia: 'Vinyl', lineage: { kind: 'none' } })).toBeNull()
    expect(validateVinylLineage({ sourceMedia: 'Vinyl', lineage: { kind: 'pasted', text: 'x' } })).toBeNull()
    expect(validateVinylLineage({ sourceMedia: 'Vinyl', lineage: { kind: 'file', path: 'a.txt' } })).toBeNull()
    expect(validateVinylLineage({ sourceMedia: 'WEB' })).toBeNull()
    expect(validateVinylLineage({ sourceMedia: 'CD' })).toBeNull()
  })
})

describe('lineageFilePath', () => {
  it('names the file each kind puts in the torrent', () => {
    expect(lineageFilePath({ kind: 'file', path: 'Lineage.TXT' })).toBe('Lineage.TXT')
    expect(lineageFilePath({ kind: 'pasted', text: 'x' })).toBe('lineage.txt')
    expect(lineageFilePath({ kind: 'none' })).toBeNull()
    expect(lineageFilePath(undefined)).toBeNull()
  })
})

describe('metadataMediaMismatch', () => {
  it('warns when a vinyl rip meets a non-vinyl release and the other way round', () => {
    expect(metadataMediaMismatch('Vinyl', { provider: 'Discogs', source: 'CD' })).toBe(
      'This Discogs release is CD, but the source media is Vinyl.'
    )
    expect(metadataMediaMismatch('WEB', { provider: 'Discogs', source: 'Vinyl' })).toBe(
      'This Discogs release is Vinyl, but the source media is WEB.'
    )
  })

  it('stays quiet when the media match, are unknown, or neither is vinyl', () => {
    expect(metadataMediaMismatch('Vinyl', { provider: 'Discogs', source: 'Vinyl' })).toBeNull()
    expect(metadataMediaMismatch('Vinyl', { provider: 'Discogs', source: '' })).toBeNull()
    expect(metadataMediaMismatch('Vinyl', undefined)).toBeNull()
    expect(metadataMediaMismatch('CD', { provider: 'Discogs', source: 'WEB' })).toBeNull()
  })
})

describe('vinylTrackCountNotice', () => {
  it('warns when Discogs lists more tracks than the folder has', () => {
    expect(vinylTrackCountNotice('Vinyl', 'Discogs', 12, 6)).toBe(
      'Discogs lists 12 tracks, the folder has 6. A multi-record set must be uploaded whole, and only the vinyl part of a mixed package.'
    )
    expect(vinylTrackCountNotice('Vinyl', 'Discogs', 6, 6)).toBeNull()
    expect(vinylTrackCountNotice('WEB', 'Discogs', 12, 6)).toBeNull()
    expect(vinylTrackCountNotice('Vinyl', 'MusicBrainz', 12, 6)).toBeNull()
  })
})
