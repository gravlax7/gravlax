import { describe, expect, it } from 'vitest'
import type { Config, TrackerConfig } from '@shared/types/config'
import type { HealthRow, UploadSnapshot } from '@shared/types'
import {
  pendingUploadTrackerIds,
  preflightTracker,
  validateTrackerHealth,
  validateToolHealth,
  validatePreparedUploadFormats,
  validateSelectedTranscodes,
  validateUploadReport,
  validateUploadTargets
} from '../validation'

function validUpload(): UploadSnapshot {
  return {
    selectedTrackerIds: ['redacted'],
    title: 'Album',
    artists: [{ name: 'A', importance: 1 }],
    year: 2020,
    media: 'WEB',
    tags: 'electronic',
    formats: [
      {
        id: 'source',
        label: 'FLAC',
        folderPath: '/w',
        format: 'FLAC',
        bitrate: 'Lossless',
        otherBitrate: '',
        vbr: false,
        releaseDesc: 'desc',
        logfileNames: []
      }
    ]
  }
}

describe('validateUploadReport', () => {
  it('accepts a complete report', () => {
    expect(validateUploadReport(validUpload())).toBeNull()
  })

  it('requires destinations and core fields', () => {
    expect(validateUploadReport({})).toBe('Select at least one tracker destination.')
    expect(validateUploadReport({ ...validUpload(), title: ' ' })).toBe('Title is required.')
    expect(validateUploadReport({ ...validUpload(), year: 0 })).toBe('Year is required.')
    expect(validateUploadReport({ ...validUpload(), media: '' })).toBe('Media is required.')
    expect(validateUploadReport({ ...validUpload(), tags: '' })).toBe('Tags are required.')
    expect(
      validateUploadReport({
        ...validUpload(),
        tags: '',
        selectedTrackerIds: ['redacted', 'orpheus'],
        groupIds: { redacted: 12, orpheus: 34 }
      })
    ).toBeNull()
    expect(
      validateUploadReport({
        ...validUpload(),
        tags: '',
        selectedTrackerIds: ['redacted', 'orpheus'],
        groupIds: { redacted: 12 }
      })
    ).toBe('Tags are required.')
    expect(validateUploadReport({ ...validUpload(), formats: [] })).toBe(
      'No upload formats are prepared.'
    )
  })

  it('requires a named main artist, not just any artist', () => {
    expect(
      validateUploadReport({ ...validUpload(), artists: [{ name: 'A', importance: 2 }] })
    ).toBe('At least one main artist is required.')
    expect(
      validateUploadReport({ ...validUpload(), artists: [{ name: '   ', importance: 1 }] })
    ).toBe('At least one main artist is required.')
  })
})

describe('prepared transcode validation', () => {
  const option = {
    id: 'transcode-V0',
    name: 'MP3 V0',
    action: 'transcode' as const,
    bitrate: 'V0' as const,
    outputFolderName: 'Album [MP3 V0]'
  }

  it('blocks upload while background transcoding is still running', () => {
    expect(validateSelectedTranscodes({ phase: 'running' })).toBe(
      'Wait for transcoding to finish before uploading.'
    )
  })

  it('requires every selected job to finish successfully', () => {
    expect(
      validateSelectedTranscodes({
        phase: 'failed',
        inspection: {
          encoding: 'Lossless',
          sampleRate: 44100,
          trackCount: 1,
          hybrid: false,
          blockers: [],
          options: [option]
        },
        selectedOptionIds: [option.id],
        jobs: [{ optionId: option.id, status: 'failed', error: 'lame failed' }]
      })
    ).toBe('Prepare every selected format before uploading: MP3 V0.')
  })

  it('requires the finished transcode in the final upload list', () => {
    const transcode = {
      phase: 'done' as const,
      inspection: {
        encoding: 'Lossless' as const,
        sampleRate: 44100,
        trackCount: 1,
        hybrid: false,
        blockers: [],
        options: [option]
      },
      selectedOptionIds: [option.id],
      jobs: [{ optionId: option.id, status: 'succeeded' as const, outputPath: '/w/v0' }]
    }

    expect(validatePreparedUploadFormats({ transcode, upload: validUpload() })).toBe(
      'The upload list is still updating with the prepared formats.'
    )
    expect(
      validatePreparedUploadFormats({
        transcode,
        upload: {
          ...validUpload(),
          formats: [validUpload().formats![0]!, { ...validUpload().formats![0]!, id: option.id }]
        }
      })
    ).toBeNull()
  })
})

// preflightTracker and validateUploadTargets only read cfg.trackers; building
// the whole Config here would break every time an unrelated section changes.
function configWith(overrides: Partial<Record<'redacted' | 'orpheus', Partial<TrackerConfig>>>): Config {
  const tracker = (patch: Partial<TrackerConfig> = {}): TrackerConfig => ({
    enabled: true,
    siteUrl: 'site.example',
    announceUrl: 'announce.example',
    apiKey: '',
    sessionCookie: '',
    coverImageHost: '',
    ...patch
  })
  return {
    trackers: {
      redacted: tracker({ coverImageHost: 'catbox', ...overrides.redacted }),
      orpheus: tracker({ coverImageHost: 'catbox', ...overrides.orpheus })
    },
    imageHosts: {
      thesungod: { enabled: false, apiKey: '' },
      imgbb: { enabled: false, apiKey: '' },
      catbox: { enabled: true },
      redacted: { enabled: false }
    }
  } as unknown as Config
}

describe('preflightTracker', () => {
  it('requires both credentials for every upload', () => {
    expect(preflightTracker(configWith({ redacted: { apiKey: 'k' } }), 'redacted')).toBe(
      'Redacted: set a session cookie in Settings.'
    )
    expect(
      preflightTracker(configWith({ redacted: { sessionCookie: 'c' } }), 'redacted')
    ).toBe('Redacted: set an API key in Settings.')
    expect(
      preflightTracker(
        configWith({ redacted: { apiKey: 'k', sessionCookie: 'c' } }),
        'redacted'
      )
    ).toBeNull()
  })

  it('reports a missing API key before a missing session cookie', () => {
    expect(preflightTracker(configWith({}), 'redacted')).toBe(
      'Redacted: set an API key in Settings.'
    )
  })
})

describe('validateUploadTargets', () => {
  const cfg = configWith({
    redacted: { apiKey: 'k', sessionCookie: 'c' },
    orpheus: { apiKey: 'k', sessionCookie: 'c' }
  })

  it('accepts a release type both trackers know', () => {
    const upload = { ...validUpload(), selectedTrackerIds: ['redacted', 'orpheus'] as const, releaseType: 'Album' }
    expect(validateUploadTargets({ ...upload, selectedTrackerIds: [...upload.selectedTrackerIds] }, cfg)).toBeNull()
  })

  it('validates the Orpheus Split override without changing Redacted', () => {
    expect(
      validateUploadTargets(
        {
          ...validUpload(),
          selectedTrackerIds: ['redacted', 'orpheus'],
          artists: [
            { name: 'A', importance: 1 },
            { name: 'B', importance: 1 }
          ],
          releaseType: 'Album',
          orpheusSplit: true
        },
        cfg
      )
    ).toBeNull()
  })

  it('rejects a release type the selected tracker lacks', () => {
    expect(
      validateUploadTargets(
        { ...validUpload(), selectedTrackerIds: ['redacted'], releaseType: 'Split' },
        cfg
      )
    ).toBe('Release type "Split" is not valid on Redacted.')
    expect(
      validateUploadTargets(
        { ...validUpload(), selectedTrackerIds: ['orpheus'], releaseType: 'Split' },
        cfg
      )
    ).toBeNull()
  })

  it('skips the release type check when joining an existing group', () => {
    expect(
      validateUploadTargets(
        {
          ...validUpload(),
          selectedTrackerIds: ['redacted'],
          releaseType: 'Split',
          groupIds: { redacted: 123 }
        },
        cfg
      )
    ).toBeNull()
  })

  it('requires an enabled cover image host for every upload target', () => {
    expect(
      validateUploadTargets(
        { ...validUpload(), selectedTrackerIds: ['redacted'], releaseType: 'Album' },
        configWith({
          redacted: { apiKey: 'k', sessionCookie: 'c', coverImageHost: '' }
        })
      )
    ).toBe('Redacted: select an enabled cover image host in Settings.')

    expect(
      validateUploadTargets(
        { ...validUpload(), selectedTrackerIds: ['redacted'], releaseType: 'Album' },
        configWith({
          redacted: { apiKey: 'k', sessionCookie: 'c', coverImageHost: 'imgbb' }
        })
      )
    ).toBe('Redacted: select an enabled cover image host in Settings.')
  })

  it('only requires a cover host for pending retry targets', () => {
    const upload = {
      ...validUpload(),
      selectedTrackerIds: ['redacted', 'orpheus'] as UploadSnapshot['selectedTrackerIds'],
      releaseType: 'Album',
      submissions: [
        {
          id: 'redacted:source',
          trackerId: 'redacted' as const,
          formatId: 'source',
          label: 'Redacted',
          status: 'done' as const
        }
      ]
    }
    const cfg = configWith({
      redacted: { apiKey: 'k', sessionCookie: 'c', coverImageHost: '' },
      orpheus: { apiKey: 'k', sessionCookie: 'c' }
    })

    expect(validateUploadTargets(upload, cfg, pendingUploadTrackerIds(upload))).toBeNull()
  })

  it('surfaces the missing session credential before release details', () => {
    expect(
      validateUploadTargets(
        { ...validUpload(), releaseType: 'Album' },
        configWith({ redacted: { apiKey: 'k' } })
      )
    ).toBe('Redacted: set a session cookie in Settings.')
  })

  it('requires both credentials even when logs use the API path', () => {
    const upload = {
      ...validUpload(),
      releaseType: 'Album',
      formats: [{ ...validUpload().formats![0]!, logfileNames: ['rip.log'] }]
    }
    expect(validateUploadTargets(upload, configWith({ redacted: { apiKey: 'k' } }))).toBe(
      'Redacted: set a session cookie in Settings.'
    )
  })
})

describe('tracker health validation', () => {
  const healthyRows: HealthRow[] = [
    { id: 'trackers:redacted:api', name: 'Redacted API', status: 'available' },
    { id: 'trackers:redacted:session', name: 'Redacted Session', status: 'available' },
    { id: 'trackers:orpheus:api', name: 'Orpheus API', status: 'available' },
    { id: 'trackers:orpheus:session', name: 'Orpheus Session', status: 'available' }
  ]

  it('requires both auth checks for every pending destination', () => {
    const rows = healthyRows.map((row) =>
      row.id === 'trackers:redacted:session'
        ? { ...row, status: 'failing' as const, detail: 'authentication failed' }
        : row
    )
    expect(validateTrackerHealth(rows, ['redacted'])).toBe(
      'Tracker health checks must pass before uploading: Redacted Session: authentication failed.'
    )
    expect(validateTrackerHealth(healthyRows, ['redacted', 'orpheus'])).toBeNull()
  })

  it('waits while a required tracker check is still in flight', () => {
    const rows = healthyRows.map((row) =>
      row.id === 'trackers:redacted:api'
        ? { ...row, status: 'checking' as const, detail: 'Checking…' }
        : row
    )
    expect(validateTrackerHealth(rows, ['redacted'])).toBe(
      'Waiting for tracker health checks to finish.'
    )
  })

  it('only requires destinations with uploads left on retry', () => {
    const upload: UploadSnapshot = {
      ...validUpload(),
      selectedTrackerIds: ['redacted', 'orpheus'],
      submissions: [
        {
          id: 'redacted:source',
          trackerId: 'redacted',
          formatId: 'source',
          label: 'Redacted',
          status: 'done'
        },
        {
          id: 'orpheus:source',
          trackerId: 'orpheus',
          formatId: 'source',
          label: 'Orpheus',
          status: 'failed'
        }
      ]
    }
    expect(pendingUploadTrackerIds(upload)).toEqual(['orpheus'])
  })

  it('does not preflight a completed destination on retry', () => {
    const upload: UploadSnapshot = {
      ...validUpload(),
      selectedTrackerIds: ['redacted', 'orpheus'],
      releaseType: 'Album',
      submissions: [
        {
          id: 'redacted:source',
          trackerId: 'redacted',
          formatId: 'source',
          label: 'Redacted',
          status: 'done'
        },
        {
          id: 'orpheus:source',
          trackerId: 'orpheus',
          formatId: 'source',
          label: 'Orpheus',
          status: 'failed'
        }
      ]
    }
    const cfg = configWith({
      redacted: { apiKey: 'api-only' },
      orpheus: { apiKey: 'key', sessionCookie: 'cookie' }
    })

    expect(
      validateUploadTargets(upload, cfg, pendingUploadTrackerIds(upload))
    ).toBeNull()
  })
})

describe('tool health validation', () => {
  const healthyTools: HealthRow[] = [
    { id: 'bin:sox', name: 'SoX', status: 'available', detail: 'SoX 14.4.2' },
    { id: 'bin:flac', name: 'FLAC', status: 'available', detail: 'FLAC 1.5.0' },
    { id: 'bin:metaflac', name: 'metaflac', status: 'available', detail: 'metaflac 1.5.0' },
    { id: 'bin:lame', name: 'LAME', status: 'available', detail: 'LAME 3.100' }
  ]

  it('accepts every required binary when available', () => {
    expect(validateToolHealth(healthyTools)).toBeNull()
  })

  it('lists missing binaries', () => {
    const rows = healthyTools.map((row) =>
      row.id === 'bin:sox' ? { ...row, status: 'missing' as const, detail: 'Missing' } : row
    )
    expect(validateToolHealth(rows)).toBe(
      'Tool health checks must pass before uploading: SoX: Missing.'
    )
  })

  it('lists failing binaries', () => {
    const rows = healthyTools.map((row) =>
      row.id === 'bin:flac'
        ? {
            ...row,
            status: 'failing' as const,
            detail: 'FLAC 1.3.1 is unsupported; version 1.5.0 or newer is required · /tools/flac'
          }
        : row
    )
    expect(validateToolHealth(rows)).toBe(
      'Tool health checks must pass before uploading: FLAC: FLAC 1.3.1 is unsupported; version 1.5.0 or newer is required · /tools/flac.'
    )
  })

  it('lists every failed binary', () => {
    const rows = healthyTools.map((row) => {
      if (row.id === 'bin:flac') {
        return { ...row, status: 'failing' as const, detail: 'too old' }
      }
      if (row.id === 'bin:lame') {
        return { ...row, status: 'missing' as const, detail: 'Missing' }
      }
      return row
    })
    expect(validateToolHealth(rows)).toBe(
      'Tool health checks must pass before uploading: FLAC: too old; LAME: Missing.'
    )
  })

  it('waits while a tool check is still in flight', () => {
    const rows = healthyTools.map((row) =>
      row.id === 'bin:lame' ? { ...row, status: 'checking' as const, detail: 'Checking…' } : row
    )
    expect(validateToolHealth(rows)).toBe('Waiting for tool health checks to finish.')
  })

  it('waits when tool rows have not been published yet', () => {
    expect(validateToolHealth(null)).toBe('Waiting for tool health checks to finish.')
    expect(validateToolHealth([])).toBe('Waiting for tool health checks to finish.')
    expect(
      validateToolHealth([{ id: 'trackers:redacted:api', name: 'Redacted API', status: 'available' }])
    ).toBe('Waiting for tool health checks to finish.')
  })
})
