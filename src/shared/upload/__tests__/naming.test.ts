import { describe, expect, it } from 'vitest'
import {
  buildFilesRenamePlan,
  isMultiDisc,
  nextRenameFlagsForPathLimits,
  validateReleaseFolderTemplate,
  validateTrackFileTemplate
} from '../naming'
import type { Release } from '../../types/upload'

const naming = {
  albumDescriptionTemplateId: 'x',
  releaseFolderTemplate: '{artists} - {title} ({year}) [{source} {format}]',
  trackFileTemplate: '{trackNumber}. {title}',
  useVariousArtistsTrackFileTemplate: true,
  variousArtistsTrackFileTemplate: '{trackNumber}. {artist} - {title}',
  multiDiscFolderTemplate: 'Disc {discNumber}'
}

function buildTrackPlan(release: Release, extra?: Partial<typeof naming>) {
  const tracks = release.tracks ?? []
  return buildFilesRenamePlan({
    release,
    files: {
      original: {},
      apply: {
        phase: 'idle',
        onDiskModified: false,
        stripEmbeddedCoverArt: true,
        renameReleaseFolder: false,
        renameTrackFiles: true,
        currentFolderName: 'old',
        files: tracks.map((_, index) => ({ id: String(index), currentPath: `${index}.flac` }))
      }
    },
    naming: { ...naming, ...extra },
    sourceMedia: 'WEB',
    encoding: 'Lossless'
  })
}

function buildFolderPlan(
  release: Parameters<typeof buildFilesRenamePlan>[0]['release'],
  releaseFolderTemplate: string
) {
  return buildFilesRenamePlan({
    release,
    files: {
      original: {},
      apply: {
        phase: 'idle',
        onDiskModified: false,
        stripEmbeddedCoverArt: true,
        renameReleaseFolder: true,
        renameTrackFiles: true,
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
      files: { original: {}, apply: { phase: 'idle', onDiskModified: false, stripEmbeddedCoverArt: true, renameReleaseFolder: true, renameTrackFiles: true, currentFolderName: 'old', files: [{ id: 'a', currentPath: 'x.flac' }, { id: 'b', currentPath: 'y.flac' }] } },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })
    expect(plan.folderName).toBe('A - Album (2001) [WEB FLAC]')
    expect(plan.files[0]?.targetPath).toBe('Disc 02/01. A_B.flac')
    expect(plan.errors).toEqual([])
  })

  it('requires the strip while art and padding are over the limit', () => {
    const plan = (stripEmbeddedCoverArt: boolean) => buildFilesRenamePlan({
      release: { title: 'Album', tracks: [{ title: 'Song' }, { title: 'Other' }] },
      files: {
        original: { oversizeArtCount: 2 },
        apply: { phase: 'idle', onDiskModified: false, stripEmbeddedCoverArt, renameReleaseFolder: false, renameTrackFiles: false, currentFolderName: 'Album', files: [{ id: 'a', currentPath: 'a.flac' }, { id: 'b', currentPath: 'b.flac' }] }
      },
      naming,
      sourceMedia: 'WEB',
      writeTags: false
    })
    expect(plan(false).errors).toEqual([
      '2 FLAC files carry more than 1024 KiB of embedded art and padding. Turn on Strip embedded cover art.'
    ])
    expect(plan(true).errors).toEqual([])
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
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: true,
          renameTrackFiles: true,
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
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: true,
          renameTrackFiles: true,
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
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: false,
          renameTrackFiles: true,
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
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: true,
          renameTrackFiles: true,
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

  it('keeps the FLAC extension when a manual name omits it', () => {
    const plan = buildFilesRenamePlan({
      release: { title: 'Album', tracks: [{ trackNumber: '2', title: 'Song' }] },
      files: {
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: false,
          renameReleaseFolder: false,
          renameTrackFiles: true,
          currentFolderName: 'Album',
          files: [{ id: 'a', currentPath: 'source.flac', filenameOverride: '02. Song' }]
        }
      },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })

    expect(plan.files[0]?.targetFilename).toBe('02. Song.flac')
    expect(plan.errors).toEqual([])
  })

  it('keeps each other file extension when a manual name omits or changes it', () => {
    const plan = buildFilesRenamePlan({
      release: { title: 'Album', tracks: [{ trackNumber: '1', title: 'Song' }] },
      files: {
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: false,
          renameReleaseFolder: false,
          renameTrackFiles: true,
          currentFolderName: 'Album',
          files: [{ id: 'track', currentPath: 'source.flac' }],
          payloadPaths: [
            { id: 'track', kind: 'file', currentPath: 'source.flac', originalPath: 'source.flac' },
            { id: 'cover', kind: 'file', currentPath: 'cover.jpg', originalPath: 'cover.jpg', nameOverride: 'sleeve.png' },
            { id: 'log', kind: 'file', currentPath: 'rip.log', originalPath: 'rip.log', nameOverride: 'proof' },
            { id: 'readme', kind: 'file', currentPath: 'README', originalPath: 'README', nameOverride: 'INFO.md' }
          ]
        }
      },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })

    expect(plan.payloadFiles?.map((file) => file.targetName)).toEqual([
      '01. Song.flac',
      'sleeve.jpg',
      'proof.log',
      'INFO.md'
    ])
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
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: false,
          renameTrackFiles: true,
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

  it('keeps tracks, nested folders, sidecars, and other files when track renaming is off', () => {
    const plan = buildFilesRenamePlan({
      release: {
        title: 'Album',
        tracks: [
          { trackNumber: '1', discNumber: '1', title: 'One' },
          { trackNumber: '1', discNumber: '2', title: 'Two' }
        ]
      },
      files: {
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: false,
          renameReleaseFolder: false,
          renameTrackFiles: false,
          currentFolderName: 'Album',
          files: [
            { id: 'a', currentPath: 'CD1/a.flac', filenameOverride: 'ignored.flac' },
            { id: 'b', currentPath: 'CD2/b.flac' }
          ],
          payloadPaths: [
            { id: 'd1', kind: 'directory', currentPath: 'CD1', originalPath: 'CD1', nameOverride: 'Ignored' },
            { id: 'd2', kind: 'directory', currentPath: 'CD2', originalPath: 'CD2' },
            { id: 'a', kind: 'file', currentPath: 'CD1/a.flac', originalPath: 'CD1/a.flac' },
            { id: 'b', kind: 'file', currentPath: 'CD2/b.flac', originalPath: 'CD2/b.flac' },
            { id: 'log', kind: 'file', currentPath: 'CD1/rip.log', originalPath: 'CD1/rip.log', nameOverride: 'ignored.log' },
            { id: 'cover', kind: 'file', currentPath: 'cover.jpg', originalPath: 'cover.jpg' }
          ]
        }
      },
      naming,
      sourceMedia: 'CD',
      encoding: 'Lossless',
      writeTags: false
    })

    expect(plan.files.map((file) => file.targetPath)).toEqual(['CD1/a.flac', 'CD2/b.flac'])
    expect(plan.folders).toEqual([])
    expect(plan.payloadFiles?.map((file) => file.targetPath)).toEqual([
      'CD1/a.flac',
      'CD2/b.flac',
      'CD1/rip.log',
      'cover.jpg'
    ])
    expect(plan.payloadFiles?.every((file) => !file.changed)).toBe(true)
    expect(plan.errors).toEqual([])
  })

  it('validates paths which stay unchanged when track renaming is off', () => {
    const longName = `${'x'.repeat(180)}.flac`
    const plan = buildFilesRenamePlan({
      release: { title: 'Album', tracks: [{ title: 'Song' }] },
      files: {
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: false,
          renameReleaseFolder: false,
          renameTrackFiles: false,
          currentFolderName: 'Album',
          files: [{ id: 'a', currentPath: longName }]
        }
      },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless',
      writeTags: false
    })

    expect(plan.files[0]?.targetPath).toBe(longName)
    expect(plan.errors).toContain(
      `${longName}: Path would be 201 characters; the limit is 180.`
    )
  })

  it('turns both renames on when current names are over the upload path limit', () => {
    const longName = `${'x'.repeat(180)}.flac`
    const input = {
      release: { title: 'Album', tracks: [{ title: 'Song' }] },
      files: {
        original: {},
        apply: {
          phase: 'idle' as const,
          onDiskModified: false,
          stripEmbeddedCoverArt: false,
          renameReleaseFolder: false,
          renameTrackFiles: false,
          currentFolderName: 'Album',
          files: [{ id: 'a', currentPath: longName }]
        }
      },
      naming,
      sourceMedia: 'WEB' as const,
      encoding: 'Lossless' as const,
      writeTags: false
    }

    expect(nextRenameFlagsForPathLimits(input)).toEqual({
      renameReleaseFolder: true,
      renameTrackFiles: true
    })
  })

  it('leaves rename choices alone when current paths already fit', () => {
    const input = {
      release: { title: 'Album', tracks: [{ title: 'Song' }] },
      files: {
        original: {},
        apply: {
          phase: 'idle' as const,
          onDiskModified: false,
          stripEmbeddedCoverArt: false,
          renameReleaseFolder: false,
          renameTrackFiles: false,
          currentFolderName: 'Album',
          files: [{ id: 'a', currentPath: 'a.flac' }]
        }
      },
      naming,
      sourceMedia: 'WEB' as const,
      encoding: 'Lossless' as const,
      writeTags: false
    }

    expect(nextRenameFlagsForPathLimits(input)).toEqual({
      renameReleaseFolder: false,
      renameTrackFiles: false
    })
  })

  it('includes tag-write and track-rename choices in the plan hash', () => {
    const base = {
      release: { title: 'Album', tracks: [{ title: 'One' }] },
      files: {
        original: {},
        apply: {
          phase: 'idle' as const,
          onDiskModified: false,
          stripEmbeddedCoverArt: false,
          renameReleaseFolder: false,
          renameTrackFiles: true,
          currentFolderName: 'Album',
          files: [{ id: 'a', currentPath: 'a.flac' }]
        }
      },
      naming,
      sourceMedia: 'WEB' as const,
      encoding: 'Lossless' as const
    }

    const writing = buildFilesRenamePlan({ ...base, writeTags: true })
    const keeping = buildFilesRenamePlan({ ...base, writeTags: false })
    const noRename = buildFilesRenamePlan({
      ...base,
      files: { ...base.files, apply: { ...base.files.apply, renameTrackFiles: false } },
      writeTags: false
    })

    expect(writing.hash).not.toBe(keeping.hash)
    expect(keeping.hash).not.toBe(noRename.hash)
  })

  it('blocks a path over 180 Unicode characters after reserving output folder space', () => {
    const plan = buildFilesRenamePlan({
      release: { title: 'é'.repeat(165), tracks: [{ trackNumber: '1', title: 'Song' }] },
      files: {
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: true,
          renameReleaseFolder: true,
          renameTrackFiles: true,
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

describe('names gravlax keeps', () => {
  function keptPlan(
    paths: string[],
    tracks: Release['tracks'],
    options: { folder?: string; others?: string[]; renameTrackFiles?: boolean } = {}
  ) {
    const files = paths.map((path, index) => ({ id: String(index), currentPath: path }))
    return buildFilesRenamePlan({
      release: { title: 'Album', tracks },
      files: {
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: false,
          renameReleaseFolder: false,
          renameTrackFiles: options.renameTrackFiles ?? false,
          currentFolderName: options.folder ?? 'Artist - Album (2024)',
          files,
          payloadPaths: [
            ...files.map((file) => ({ ...file, kind: 'file' as const, originalPath: file.currentPath })),
            ...(options.others ?? []).map((path) => ({ id: path, kind: 'file' as const, currentPath: path, originalPath: path }))
          ]
        }
      },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless',
      writeTags: false
    })
  }
  const two = [{ trackNumber: '1', title: 'One' }, { trackNumber: '2', title: 'Two' }]
  const hint = ' Turn on Rename FLAC tracks to edit it.'

  it('passes names that follow the rules', () => {
    const plan = keptPlan(['01 - One.flac', '02 - Two.flac'], two, { others: ['cover.jpg'] })
    expect(plan.errors).toEqual([])
    expect(plan.warnings).toEqual([])
  })

  it.each([
    ['Art: Front.jpg', 'Art: Front.jpg: Name contains a character which is not allowed.'],
    ['Art `Front`.jpg', 'Art `Front`.jpg: Name contains a character which is not allowed.'],
    [' cover.jpg', ' cover.jpg: Name cannot start with a space.'],
    ['Scans Back/back.jpg', 'Scans Back: Name contains a space other than a plain space.']
  ])('blocks the kept name %j', (other, error) => {
    expect(keptPlan(['01 - One.flac', '02 - Two.flac'], two, { others: [other] }).errors)
      .toEqual([`${error}${hint}`])
  })

  it('blocks a kept name while track renaming is on, without the hint', () => {
    const plan = keptPlan(['a.flac'], [{ trackNumber: '1', title: 'One' }], {
      others: ['Art: Front.jpg'],
      renameTrackFiles: true
    })
    expect(plan.errors).toEqual(['Art: Front.jpg: Name contains a character which is not allowed.'])
  })

  it('blocks a kept release folder name', () => {
    expect(keptPlan(['01 - One.flac', '02 - Two.flac'], two, { folder: ' Album' }).errors).toEqual([
      'Release folder: Name cannot start with a space. Turn on Rename release folder to edit it.'
    ])
  })

  it('replaces a backtick in generated names and blocks one in a typed name', () => {
    const generated = buildTrackPlan({ title: 'Album', tracks: [{ trackNumber: '1', title: 'Don`t' }] })
    expect(generated.files[0]?.targetFilename).toBe('01. Don_t.flac')
    expect(generated.errors).toEqual([])
    const typed = buildFilesRenamePlan({
      release: { title: 'Album', tracks: [{ trackNumber: '1', title: 'One' }] },
      files: {
        original: {},
        apply: {
          phase: 'idle',
          onDiskModified: false,
          stripEmbeddedCoverArt: false,
          renameReleaseFolder: false,
          renameTrackFiles: true,
          currentFolderName: 'Album',
          files: [{ id: '0', currentPath: '0.flac', filenameOverride: 'Don`t' }]
        }
      },
      naming,
      sourceMedia: 'WEB',
      encoding: 'Lossless'
    })
    expect(typed.errors).toEqual(['Don`t.flac: Name contains a character which is not allowed.'])
  })

  it.each([
    [['01track.flac', '02track.flac'], two, ['01track.flac: The name lacks the title.', '02track.flac: The name lacks the title.']],
    [['One.flac', 'Two.flac'], two, ['One.flac: The name lacks the track number.', 'Two.flac: The name lacks the track number.']],
    [['01 - One.FLAC', '02 - Two.flac'], two, ['01 - One.FLAC: Use a lowercase .flac extension.']],
    [['1 - One.flac', '103 - Two.flac'], [{ trackNumber: '1', title: 'One' }, { trackNumber: '3', title: 'Two' }], []],
    [
      ['01 - A Very Long Title Cut Sh.flac', '02 - Two.flac'],
      [{ trackNumber: '1', title: 'A Very Long Title Cut Short' }, { trackNumber: '2', title: 'Two (feat. Guest)' }],
      []
    ],
    [
      Array.from({ length: 10 }, (_, index) => `${index + 1} - x.flac`),
      Array.from({ length: 10 }, (_, index) => ({ trackNumber: String(index + 1), title: 'x' })),
      ['Names do not sort in play order: 10 - x.flac comes before 2 - x.flac.']
    ],
    [
      ['CD1/01 - One.flac', 'CD1/01 - Two.flac'],
      [{ discNumber: '1', trackNumber: '1', title: 'One' }, { discNumber: '2', trackNumber: '1', title: 'Two' }],
      ['CD1: Tracks from different discs share a number. Number them on, or give each disc its own folder.']
    ],
    [
      ['1 01 - One.flac', '2 01 - Two.flac'],
      [{ discNumber: '1', trackNumber: '1', title: 'One' }, { discNumber: '2', trackNumber: '1', title: 'Two' }],
      []
    ],
    [
      ['CD1/01 - One.flac', 'CD2/01 - Two.flac'],
      [{ discNumber: '1', trackNumber: '1', title: 'One' }, { discNumber: '2', trackNumber: '1', title: 'Two' }],
      []
    ]
  ])('warns about the kept track names %j', (paths, tracks, warnings) => {
    expect(keptPlan(paths, tracks).warnings).toEqual(warnings)
  })

  it('warns when the kept folder name lacks the album title', () => {
    expect(keptPlan(['01 - One.flac', '02 - Two.flac'], two, { folder: 'Artist (2024)' }).warnings)
      .toEqual(['The release folder name lacks the album title.'])
  })
})

describe('various artists track file template', () => {
  it('includes the track artist when the album has no single main artist', () => {
    const plan = buildTrackPlan({
      tracks: [
        { trackNumber: '1', title: 'One', artists: [{ name: 'A' }] },
        { trackNumber: '2', title: 'Two', artists: [{ name: 'B' }] }
      ]
    })
    expect(plan.files.map((file) => file.targetFilename)).toEqual([
      '01. A - One.flac',
      '02. B - Two.flac'
    ])
    expect(plan.errors).toEqual([])
  })

  it('includes the track artist when the album is credited to Various Artists', () => {
    const plan = buildTrackPlan({
      artists: [{ name: 'Various Artists', role: 'main' }],
      albumArtist: 'Various Artists',
      tracks: [
        { trackNumber: '1', title: 'One', artists: [{ name: 'A' }] },
        { trackNumber: '2', title: 'Two', artists: [{ name: 'B' }] }
      ]
    })
    expect(plan.files.map((file) => file.targetFilename)).toEqual([
      '01. A - One.flac',
      '02. B - Two.flac'
    ])
    expect(plan.errors).toEqual([])
  })

  it('includes the track artist when the album has four main artists', () => {
    const plan = buildTrackPlan({
      artists: [
        { name: 'A', role: 'main' },
        { name: 'B', role: 'main' },
        { name: 'C', role: 'main' },
        { name: 'D', role: 'main' }
      ],
      tracks: [
        { trackNumber: '1', title: 'One', artists: [{ name: 'A' }] },
        { trackNumber: '2', title: 'Two', artists: [{ name: 'B' }] }
      ]
    })
    expect(plan.files.map((file) => file.targetFilename)).toEqual([
      '01. A - One.flac',
      '02. B - Two.flac'
    ])
    expect(plan.errors).toEqual([])
  })

  it('keeps the track file template when the album has one main artist', () => {
    const plan = buildTrackPlan({
      artists: [{ name: 'Arno', role: 'main' }, { name: 'Jane Birkin', role: 'guest' }],
      albumArtist: 'Arno',
      tracks: [
        { trackNumber: '1', title: 'One', artists: [{ name: 'Arno' }, { name: 'Jane Birkin' }] },
        { trackNumber: '2', title: 'Two', artists: [{ name: 'Arno' }, { name: 'Stephan Eicher' }] }
      ]
    })
    expect(plan.files.map((file) => file.targetFilename)).toEqual([
      '01. One.flac',
      '02. Two.flac'
    ])
    expect(plan.errors).toEqual([])
  })

  it('keeps the single-artist template when every track has the same main artists', () => {
    const plan = buildTrackPlan({
      tracks: [
        { trackNumber: '1', title: 'One', artists: [{ name: 'A' }] },
        { trackNumber: '2', title: 'Two', artists: [{ name: 'A' }] }
      ]
    })
    expect(plan.files.map((file) => file.targetFilename)).toEqual([
      '01. One.flac',
      '02. Two.flac'
    ])
    expect(plan.errors).toEqual([])
  })

  it('does not switch when only guest artists differ', () => {
    const plan = buildTrackPlan({
      tracks: [
        { trackNumber: '1', title: 'One', artists: [{ name: 'A' }, { name: 'X', role: 'guest' }] },
        { trackNumber: '2', title: 'Two', artists: [{ name: 'A' }, { name: 'Y', role: 'guest' }] }
      ]
    })
    expect(plan.files.map((file) => file.targetFilename)).toEqual([
      '01. One.flac',
      '02. Two.flac'
    ])
    expect(plan.errors).toEqual([])
  })

  it('uses the track file template when the various-artists template is off', () => {
    const plan = buildTrackPlan(
      {
        tracks: [
          { trackNumber: '1', title: 'One', artists: [{ name: 'A' }] },
          { trackNumber: '2', title: 'Two', artists: [{ name: 'B' }] }
        ]
      },
      { useVariousArtistsTrackFileTemplate: false }
    )
    expect(plan.files.map((file) => file.targetFilename)).toEqual([
      '01. One.flac',
      '02. Two.flac'
    ])
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
