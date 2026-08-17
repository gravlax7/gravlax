import { describe, expect, it } from 'vitest'
import {
  buildFilesRenamePlan,
  isMultiDisc,
  validateReleaseFolderTemplate,
  validateTrackFileTemplate
} from '../naming'

const naming = {
  albumDescriptionTemplateId: 'x',
  releaseFolderTemplate: '{artists} - {title} ({year}) [{source} {format}]',
  trackFileTemplate: '{trackNumber}. {title}',
  multiDiscFolderTemplate: 'Disc {discNumber}'
}

function buildFolderPlan(
  release: Parameters<typeof buildFilesRenamePlan>[0]['release'],
  releaseFolderTemplate: string
) {
  return buildFilesRenamePlan({
    release,
    files: {
      original: { captured: false, coverCaptured: false, folderName: 'old', files: [] },
      apply: {
        phase: 'idle',
        onDiskModified: false,
        stripEmbeddedCoverArt: true,
        renameReleaseFolder: true,
        currentFolderName: 'old',
        files: []
      }
    },
    naming: { ...naming, releaseFolderTemplate },
    sourceMedia: 'WEB',
    encoding: 'Lossless'
  })
}

describe('naming template validation', () => {
  it('accepts escaped literal braces around known fields', () => {
    expect(validateReleaseFolderTemplate('{{{label}, {catNoOrUpc}}}')).toEqual([])
    expect(validateTrackFileTemplate('{{{trackNumber}}}. {title}')).toEqual([])
  })

  it('reports unknown fields inside escaped braces', () => {
    expect(validateReleaseFolderTemplate('{{{missing}}}')).toEqual([
      'Unknown template field {missing}.'
    ])
  })

  it.each(['{label', 'label}', '{}', '{{label}'])(
    'reports unmatched braces in %s',
    (template) => {
      expect(validateReleaseFolderTemplate(template)).toContain(
        'Template contains an unmatched brace.'
      )
    }
  )
})

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

  it('renders raw UPC and prefers CatNo in the fallback field', () => {
    const release = { title: 'Album', label: 'Label', catNo: 'CAT-001', upc: '123456789' }

    expect(buildFolderPlan(release, '{title} [{upc}]').folderName).toBe(
      'Album [123456789]'
    )
    expect(
      buildFolderPlan(release, '{title} {{{label}, {catNoOrUpc}}}').folderName
    ).toBe('Album {Label, CAT-001}')
  })

  it.each([
    [{ label: 'Label', upc: '123456789' }, 'Album {Label, 123456789}'],
    [{ label: 'Label' }, 'Album {Label}'],
    [{ upc: '123456789' }, 'Album {123456789}'],
    [{}, 'Album']
  ])('cleans missing values from a literal brace group', (fields, expected) => {
    const plan = buildFolderPlan(
      { title: 'Album', ...fields },
      '{title} {{{label}, {catNoOrUpc}}}'
    )

    expect(plan.folderName).toBe(expected)
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
