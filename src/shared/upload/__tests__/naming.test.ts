import { describe, expect, it } from 'vitest'
import { buildFilesRenamePlan, isMultiDisc } from '../naming'

const naming = {
  albumDescriptionTemplateId: 'x',
  releaseFolderTemplate: '{artists} - {title} ({year}) [{source} {format}]',
  trackFileTemplate: '{trackNumber}. {title}',
  multiDiscFolderTemplate: 'Disc {discNumber}'
}

describe('buildFilesRenamePlan', () => {
  it('pads tracks and creates disc and release folders', () => {
    const plan = buildFilesRenamePlan({
      release: { artists: [{ name: 'A' }], title: 'Album', groupYear: '2001', tracks: [{ trackNumber: '1', discNumber: '2', title: 'A/B' }, { trackNumber: '2', discNumber: '1', title: 'Song' }] },
      files: { original: { captured: false, coverCaptured: false, folderName: 'old', files: [] }, apply: { phase: 'idle', onDiskModified: false, stripEmbeddedCoverArt: true, renameReleaseFolder: true, currentFolderName: 'old', files: [{ id: 'a', currentPath: 'x.flac' }, { id: 'b', currentPath: 'y.flac' }] } },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })
    expect(plan.folderName).toBe('A - Album (2001) [WEB FLAC]')
    expect(plan.files[0]?.targetPath).toBe('Disc 02/01. A_B.flac')
    expect(plan.errors).toEqual([])
  })

  it('removes invisible Unicode formatting characters from generated names', () => {
    const plan = buildFilesRenamePlan({
      release: {
        artists: [{ name: 'A\u2060rtist' }],
        title: 'Alb\u200bum',
        groupYear: '2001',
        tracks: [{ trackNumber: '2', title: '\u03a9 \u2060\u2060Cosmos' }]
      },
      files: {
        original: { captured: false, coverCaptured: false, folderName: 'old', files: [] },
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: true,
          currentFolderName: 'old',
          files: [{ id: 'a', currentPath: 'source.flac' }]
        }
      },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })

    expect(plan.folderName).toBe('Artist - Album (2001) [WEB FLAC]')
    expect(plan.files[0]?.targetPath).toBe('02. \u03a9 Cosmos.flac')
    expect(plan.errors).toEqual([])
  })

  it('removes invisible Unicode formatting characters from manual names', () => {
    const plan = buildFilesRenamePlan({
      release: {
        artists: [{ name: 'Artist' }],
        title: 'Album',
        groupYear: '2001',
        tracks: [{ trackNumber: '2', title: 'Cosmos' }]
      },
      files: {
        original: { captured: false, coverCaptured: false, folderName: 'old', files: [] },
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: true,
          currentFolderName: 'old',
          folderNameOverride: 'Clean\ufeff Folder',
          files: [{
            id: 'a',
            currentPath: 'source.flac',
            filenameOverride: '02. \u2060\u2060Cosmos.flac'
          }]
        }
      },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })

    expect(plan.folderName).toBe('Clean Folder')
    expect(plan.files[0]?.targetPath).toBe('02. Cosmos.flac')
    expect(plan.errors).toEqual([])
  })
})

describe('isMultiDisc', () => {
  it('is true only when a track carries a disc above one', () => {
    expect(isMultiDisc(['1', '1'])).toBe(false)
    expect(isMultiDisc(['1', '2'])).toBe(true)
    // Reads the leading integer, so these all resolve to disc one.
    expect(isMultiDisc(['1/1'])).toBe(false)
    expect(isMultiDisc(['01', ''])).toBe(false)
    expect(isMultiDisc([undefined, ''])).toBe(false)
  })
})
