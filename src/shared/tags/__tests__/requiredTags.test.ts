import { describe, expect, it } from 'vitest'
import type { Release, Track } from '@shared/types'
import { missingRequiredTags } from '../requiredTags'

const track = (fields: Partial<Track> = {}): Track => ({
  trackNumber: '1', title: 'Song', artists: [{ name: 'Artist', role: 'main' }], ...fields
})

describe('missingRequiredTags', () => {
  it.each<[string, Release, string[]]>([
    ['a complete release', { title: 'Album', tracks: [track(), track({ trackNumber: '2' })] }, []],
    ['no tracks yet', { title: '' }, []],
    ['no album title', { tracks: [track()] }, ['The album has no title.']],
    ['no track title', { title: 'Album', tracks: [track(), track({ trackNumber: '3', title: ' ' })] },
      ['Track 3 has no title.']],
    ['only a guest artist', { title: 'Album', tracks: [track({ artists: [{ name: 'Guest', role: 'guest' }] })] },
      ['Track 1 has no artist.']],
    ['a conductor as the artist', { title: 'Album', tracks: [track({ artists: [{ name: 'C', role: 'conductor' }] })] }, []],
    ['no number on a single', { title: 'Album', tracks: [track({ trackNumber: '' })] }, []],
    ['no number on an album', { title: 'Album', tracks: [track(), track({ trackNumber: '' })] },
      ['Track 2 has no track number.']],
    ['a multi-disc set', { title: 'Album', tracks: [track({ discNumber: '1' }), track({ discNumber: '2', title: '' })] },
      ['Track 2-1 has no title.']]
  ])('checks %s', (_name, release, errors) => {
    expect(missingRequiredTags(release)).toEqual(errors)
  })
})
