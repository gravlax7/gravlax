import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { UploadFormatPayload, UploadSnapshot } from '@shared/types/upload'
import { buildTrackerUploadData, collectLogFiles } from '../payload'

function sourceFormat(patch: Partial<UploadFormatPayload> = {}): UploadFormatPayload {
  return {
    id: 'source',
    label: 'FLAC Lossless',
    folderPath: '/ws/Album',
    format: 'FLAC',
    bitrate: 'Lossless',
    otherBitrate: '',
    vbr: false,
    releaseDesc: 'release description',
    logfileNames: [],
    ...patch
  }
}

function upload(patch: Partial<UploadSnapshot> = {}): UploadSnapshot {
  return {
    selectedTrackerIds: ['redacted'],
    artists: [
      { name: 'Main', importance: 1 },
      { name: 'Guest', importance: 2 }
    ],
    title: 'Album',
    year: 2019,
    releaseType: 'Album',
    unknown: false,
    remasterYear: 2020,
    remasterTitle: 'Remaster',
    remasterRecordLabel: 'Label',
    remasterCatalogueNumber: 'CAT-1',
    scene: false,
    media: 'WEB',
    tags: 'electronic,ambient',
    image: 'https://img/cover.jpg',
    albumDesc: 'album description',
    ...patch
  }
}

describe('buildTrackerUploadData', () => {
  it('builds a full new-group payload', () => {
    const data = buildTrackerUploadData({
      upload: upload(),
      format: sourceFormat(),
      trackerId: 'redacted'
    })

    expect(data).toEqual({
      submit: true,
      type: 0,
      title: 'Album',
      'artists[]': ['Main', 'Guest'],
      'importance[]': [1, 2],
      year: 2019,
      releasetype: 1,
      record_label: 'Label',
      catalogue_number: 'CAT-1',
      remaster: true,
      remaster_year: 2020,
      remaster_title: 'Remaster',
      remaster_record_label: 'Label',
      remaster_catalogue_number: 'CAT-1',
      format: 'FLAC',
      bitrate: 'Lossless',
      other_bitrate: '',
      vbr: false,
      media: 'WEB',
      tags: 'electronic,ambient',
      image: 'https://img/cover.jpg',
      album_desc: 'album description',
      release_desc: 'release description',
      scene: false,
      unknown: false
    })
  })

  it('keeps artists and importances aligned', () => {
    const data = buildTrackerUploadData({
      upload: upload({
        artists: [
          { name: 'A', importance: 1 },
          { name: 'B', importance: 4 },
          { name: 'C', importance: 7 }
        ]
      }),
      format: sourceFormat(),
      trackerId: 'redacted'
    })
    expect(data['artists[]']).toEqual(['A', 'B', 'C'])
    expect(data['importance[]']).toEqual([1, 4, 7])
  })

  it('maps release types per tracker', () => {
    const demo = upload({ releaseType: 'Demo' })
    expect(
      buildTrackerUploadData({ upload: demo, format: sourceFormat(), trackerId: 'redacted' })
        .releasetype
    ).toBe(17)
    expect(
      buildTrackerUploadData({ upload: demo, format: sourceFormat(), trackerId: 'orpheus' })
        .releasetype
    ).toBe(10)
  })

  it('uses Split for Orpheus while keeping the shared type on Redacted', () => {
    const split = upload({
      selectedTrackerIds: ['redacted', 'orpheus'],
      artists: [
        { name: 'A', importance: 1 },
        { name: 'B', importance: 1 }
      ],
      orpheusSplit: true
    })

    expect(
      buildTrackerUploadData({ upload: split, format: sourceFormat(), trackerId: 'redacted' })
        .releasetype
    ).toBe(1)
    expect(
      buildTrackerUploadData({ upload: split, format: sourceFormat(), trackerId: 'orpheus' })
        .releasetype
    ).toBe(12)
    expect(
      buildTrackerUploadData({
        upload: split,
        format: sourceFormat({ id: 'transcode-320', format: 'MP3', bitrate: '320' }),
        trackerId: 'orpheus'
      }).releasetype
    ).toBe(12)
  })

  it('rejects a release type the tracker does not have', () => {
    expect(() =>
      buildTrackerUploadData({
        upload: upload({ releaseType: 'Split' }),
        format: sourceFormat(),
        trackerId: 'redacted'
      })
    ).toThrow('Release type "Split" is not valid on Redacted')
  })

  it('drops group-level fields when joining an existing group', () => {
    const data = buildTrackerUploadData({
      upload: upload(),
      format: sourceFormat(),
      trackerId: 'redacted',
      groupId: 4242
    })

    expect(data.groupid).toBe(4242)
    expect(data.release_desc).toBe('release description')
    for (const key of [
      'title',
      'artists[]',
      'importance[]',
      'year',
      'releasetype',
      'tags',
      'image',
      'album_desc'
    ]) {
      expect(data).not.toHaveProperty(key)
    }
  })

  it('does not validate the release type for an existing group', () => {
    expect(() =>
      buildTrackerUploadData({
        upload: upload({ releaseType: 'Split' }),
        format: sourceFormat(),
        trackerId: 'redacted',
        groupId: 1
      })
    ).not.toThrow()
  })

  it('carries per-format encoding fields', () => {
    const data = buildTrackerUploadData({
      upload: upload(),
      format: sourceFormat({
        format: 'MP3',
        bitrate: 'V0 (VBR)',
        vbr: true,
        releaseDesc: 'transcode description'
      }),
      trackerId: 'redacted'
    })
    expect(data.format).toBe('MP3')
    expect(data.bitrate).toBe('V0 (VBR)')
    expect(data.vbr).toBe(true)
    expect(data.release_desc).toBe('transcode description')
  })

  it('passes scene and unknown through as booleans', () => {
    const data = buildTrackerUploadData({
      upload: upload({ scene: true, unknown: true }),
      format: sourceFormat(),
      trackerId: 'redacted'
    })
    expect(data.scene).toBe(true)
    expect(data.unknown).toBe(true)
  })
})

describe('collectLogFiles', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'gravlax-logs-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('reads logs relative to the format folder, flattening to basenames', async () => {
    await mkdir(join(root, 'CD1'), { recursive: true })
    await writeFile(join(root, 'rip.log'), 'top')
    await writeFile(join(root, 'CD1', 'disc.log'), 'nested')

    const logs = await collectLogFiles(root, ['rip.log', 'CD1/disc.log'])

    expect(logs?.map((l) => l.filename)).toEqual(['rip.log', 'disc.log'])
    expect(Buffer.from(logs![1]!.data as Uint8Array).toString()).toBe('nested')
  })

  it('returns an empty list when there are no logs', async () => {
    expect(await collectLogFiles(root, [])).toEqual([])
  })
})
