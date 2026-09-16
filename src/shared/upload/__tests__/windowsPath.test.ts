import { describe, expect, it } from 'vitest'
import { buildFilesRenamePlan } from '../naming'

const naming = {
  albumDescriptionTemplateId: 'x',
  releaseFolderTemplate: '{title}',
  trackFileTemplate: '{title}',
  useVariousArtistsTrackFileTemplate: false,
  variousArtistsTrackFileTemplate: '{title}',
  multiDiscFolderTemplate: 'Disc {discNumber}'
}

function plan(title: string, trackTitle?: string, filenameOverride?: string) {
  return buildFilesRenamePlan({
    release: { title, tracks: trackTitle ? [{ title: trackTitle }] : [] },
    files: {
      original: {},
      apply: {
        phase: 'idle',
        onDiskModified: false,
        stripEmbeddedCoverArt: true,
        renameReleaseFolder: true,
        renameTrackFiles: true,
        currentFolderName: 'old',
        files: trackTitle ? [{ id: '1', currentPath: 'old.flac', filenameOverride }] : []
      }
    },
    naming,
    sourceMedia: 'WEB',
    encoding: 'Lossless'
  })
}

describe('Windows names generated from templates', () => {
  it.each([
    ['CON', '_CON'],
    ['NUL.txt', '_NUL.txt'],
    ['COM¹', '_COM¹']
  ])('makes the reserved release name %s safe', (title, expected) => {
    const result = plan(title)
    expect(result.folderName).toBe(expected)
    expect(result.errors).toEqual([])
  })

  it.each([
    ['NUL', '_NUL.flac'],
    ['COM1.mix', '_COM1.mix.flac']
  ])('makes the reserved track name %s safe', (title, expected) => {
    const result = plan('Album', title)
    expect(result.files[0]?.targetFilename).toBe(expected)
    expect(result.errors).toEqual([])
  })

  it('rejects a reserved manual track name', () => {
    const result = plan('Album', 'Song', 'COM¹.flac')
    expect(result.errors).toContain('old.flac: Name is reserved by the filesystem.')
  })
})
