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

  it('uses four-digit years in folder tokens', () => {
    const plan = buildFilesRenamePlan({
      release: {
        artists: [{ name: 'A' }],
        title: 'Album',
        year: '2020-05-17',
        groupYear: '2018-09-21',
        tracks: [{ trackNumber: '1', title: 'Song' }]
      },
      files: {
        original: { captured: false, coverCaptured: false, folderName: 'old', files: [] },
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: true,
          currentFolderName: 'old',
          files: [{ id: 'a', currentPath: 'x.flac' }]
        }
      },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })
    expect(plan.folderName).toBe('A - Album (2020) [WEB FLAC]')
    expect(
      buildFolderPlan(
        { artists: [{ name: 'A' }], title: 'Album', groupYear: '2018-09-21', tracks: [{ title: 'Song' }] },
        '{artists} - {title} ({groupYear})'
      ).folderName
    ).toBe('A - Album (2018)')
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

  it('treats equivalent Unicode forms as the same filename', () => {
    const plan = buildFilesRenamePlan({
      release: {
        title: 'Album',
        tracks: [{ trackNumber: '9', title: 'Phe\u0301nix' }]
      },
      files: {
        original: { captured: false, coverCaptured: false, folderName: 'Album', files: [] },
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: false,
          currentFolderName: 'Album',
          files: [{ id: 'a', currentPath: '09. Ph\u00e9nix.flac' }]
        }
      },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })

    expect(plan.files[0]).toMatchObject({
      targetPath: '09. Ph\u00e9nix.flac',
      changed: false
    })
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

  it('plans sidecars and one editable folder path with their tracks', () => {
    const plan = buildFilesRenamePlan({
      release: {
        title: 'Album',
        tracks: [
          { trackNumber: '1', discNumber: '1', title: 'One' },
          { trackNumber: '1', discNumber: '2', title: 'Two' }
        ]
      },
      files: {
        original: { captured: false, coverCaptured: false, folderName: 'old', files: [] },
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: false,
          currentFolderName: 'old',
          files: [
            { id: 'a', currentPath: 'CD1/a.flac' },
            { id: 'b', currentPath: 'CD2/b.flac' }
          ],
          payloadPaths: [
            { id: 'd1', kind: 'directory', currentPath: 'CD1', originalPath: 'CD1', nameOverride: 'First Disc' },
            { id: 'd2', kind: 'directory', currentPath: 'CD2', originalPath: 'CD2' },
            { id: 'a', kind: 'file', currentPath: 'CD1/a.flac', originalPath: 'CD1/a.flac' },
            { id: 'b', kind: 'file', currentPath: 'CD2/b.flac', originalPath: 'CD2/b.flac' },
            { id: 'log', kind: 'file', currentPath: 'CD1/rip.log', originalPath: 'CD1/rip.log' }
          ]
        }
      },
      naming,
      sourceMedia: 'CD',
      encoding: 'Lossless'
    })

    expect(plan.folders?.map((folder) => folder.targetPath)).toEqual(['First Disc', 'Disc 02'])
    expect(plan.files.map((file) => file.targetPath)).toEqual([
      'First Disc/01. One.flac',
      'Disc 02/01. Two.flac'
    ])
    expect(plan.payloadFiles?.find((file) => file.id === 'log')?.targetPath).toBe('First Disc/rip.log')
  })

  it('blocks a path over 180 Unicode characters after reserving output folder space', () => {
    const plan = buildFilesRenamePlan({
      release: { title: 'é'.repeat(165), tracks: [{ trackNumber: '1', title: 'Song' }] },
      files: {
        original: { captured: false, coverCaptured: false, folderName: 'old', files: [] },
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: true,
          currentFolderName: 'old',
          files: [{ id: 'a', currentPath: 'a.flac' }]
        }
      },
      naming: { ...naming, releaseFolderTemplate: '{title}' },
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })

    expect(plan.errors).toContain('01. Song.flac: Path would be 189 characters; the limit is 180.')
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
