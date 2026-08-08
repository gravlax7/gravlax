import { writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Config } from '@shared/types/config'
import { defaultConfig } from '@main/core/config/defaults'
import { healthcheckImageHosts } from '../health'
import { redactedProvider } from '../redacted'
import { selectCoverImageHost, uploadCoverImage } from '../upload'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])

function cfg(): Config {
  const c = structuredClone(defaultConfig())
  c.imageHosts.imgbb.enabled = true
  c.imageHosts.imgbb.apiKey = 'imgbb-key'
  c.imageHosts.thesungod.enabled = true
  c.imageHosts.thesungod.apiKey = 'sun-key'
  c.imageHosts.redacted.enabled = true
  c.trackers.redacted.enabled = true
  c.trackers.redacted.siteUrl = 'https://redacted.example'
  c.trackers.redacted.announceUrl = 'https://flacsfor.me'
  c.trackers.redacted.apiKey = 'red-key'
  c.trackers.redacted.coverImageHost = 'imgbb'
  c.trackers.orpheus.enabled = true
  c.trackers.orpheus.siteUrl = 'https://orpheus.example'
  c.trackers.orpheus.announceUrl = 'https://home.opsfet.ch'
  c.trackers.orpheus.apiKey = 'ops-key'
  c.trackers.orpheus.coverImageHost = 'thesungod'
  return c
}

describe('selectCoverImageHost', () => {
  it('uses the single tracker cover host', () => {
    const c = cfg()
    expect(selectCoverImageHost(c, ['redacted'])).toBe('imgbb')
    expect(selectCoverImageHost(c, ['orpheus'])).toBe('thesungod')
  })

  it('prefers a non-redacted host when multiple trackers are selected', () => {
    const c = cfg()
    c.trackers.redacted.coverImageHost = 'redacted'
    c.trackers.orpheus.coverImageHost = 'imgbb'
    expect(selectCoverImageHost(c, ['redacted', 'orpheus'])).toBe('imgbb')
  })

  it('does not use the redacted host for a multi-tracker upload', () => {
    const c = cfg()
    c.trackers.redacted.coverImageHost = 'redacted'
    c.trackers.orpheus.coverImageHost = ''
    expect(selectCoverImageHost(c, ['redacted', 'orpheus'])).toBeNull()
  })

  it('returns null when no host is configured', () => {
    const c = cfg()
    c.trackers.redacted.coverImageHost = ''
    c.trackers.orpheus.coverImageHost = ''
    expect(selectCoverImageHost(c, ['redacted', 'orpheus'])).toBeNull()
  })
})

describe('uploadCoverImage', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('uploads to imgbb', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-img-'))
    const file = path.join(dir, 'cover.jpg')
    await writeFile(file, JPEG)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const body = init?.body as FormData
        expect(body.get('key')).toBe('imgbb-key')
        expect(body.get('image')).toBeInstanceOf(Blob)
        return Response.json({ data: { url: 'https://i.ibb.co/x.jpg' } })
      })
    )

    expect(await uploadCoverImage(cfg(), 'imgbb', file)).toBe('https://i.ibb.co/x.jpg')
  })

  it('uploads to thesungod', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-img-'))
    const file = path.join(dir, 'cover.jpg')
    await writeFile(file, JPEG)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(String(url)).toContain('/api/image/upload')
        const body = init?.body as FormData
        expect(body.get('api_key')).toBe('sun-key')
        return Response.json({ links: ['https://cdn.thesungod.xyz/images/a.jpg'] })
      })
    )

    expect(await uploadCoverImage(cfg(), 'thesungod', file)).toBe(
      'https://cdn.thesungod.xyz/images/a.jpg'
    )
  })

  it('uploads to redacted image host', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-img-'))
    const file = path.join(dir, 'cover.jpg')
    await writeFile(file, JPEG)

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        expect(String(url)).toBe('https://redacted.example/ajax.php?action=upload_image')
        expect((init?.headers as Record<string, string>).Authorization).toBe('red-key')
        expect((init?.headers as Record<string, string>).Cookie).toBeUndefined()
        const body = init?.body as FormData
        expect(body.get('file')).toBeInstanceOf(Blob)
        expect(body.get('file_input')).toBeNull()
        return Response.json({
          status: 'success',
          response: { url: 'https://redacted.example/img.jpg' }
        })
      })
    )

    expect(await uploadCoverImage(cfg(), 'redacted', file)).toBe(
      'https://redacted.example/img.jpg'
    )
  })

  it('requires an API key instead of a session cookie for redacted', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-img-'))
    const file = path.join(dir, 'cover.jpg')
    await writeFile(file, JPEG)
    const c = cfg()
    c.trackers.redacted.apiKey = ''
    c.trackers.redacted.sessionCookie = 'session-cookie'
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(uploadCoverImage(c, 'redacted', file)).rejects.toThrow(
      'RED image host requires a Redacted API key.'
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces a redacted rejection from an HTTP 400 response', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-img-'))
    const file = path.join(dir, 'cover.jpg')
    await writeFile(file, JPEG)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json(
          {
            status: 'failure',
            error: 'could not process image: image dimensions are too small'
          },
          { status: 400 }
        )
      )
    )

    await expect(uploadCoverImage(cfg(), 'redacted', file)).rejects.toThrow(
      'RED rejected the image: could not process image: image dimensions are too small'
    )
  })

  it('reports the tracker API key in redacted health checks', () => {
    const c = cfg()
    const target = redactedProvider.healthTarget(c)
    expect(target.requiresApiKey).toBe(true)
    expect(target.apiKey).toBe('red-key')
    expect(target.headers).toEqual({ Authorization: 'red-key' })
  })

  it('reports a missing API key when redacted only has a session cookie', async () => {
    const c = cfg()
    c.imageHosts.imgbb.enabled = false
    c.imageHosts.thesungod.enabled = false
    c.trackers.redacted.apiKey = ''
    c.trackers.redacted.sessionCookie = 'session-cookie'

    const rows = await healthcheckImageHosts(c)
    expect(rows.find((row) => row.id === 'img:redacted')).toMatchObject({
      status: 'failing',
      detail: 'Missing API key'
    })
  })

  it('reports an invalid Ra API key without uploading an image', async () => {
    const c = cfg()
    c.imageHosts.imgbb.enabled = false
    c.imageHosts.redacted.enabled = false
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        if (init?.method === 'GET') return new Response('method not allowed', { status: 405 })

        expect(init?.method).toBe('POST')
        const body = init?.body as FormData
        expect(body.get('api_key')).toBe('sun-key')
        expect(body.get('image')).toBeNull()
        return Response.json({ error: 'Invalid API key' }, { status: 401 })
      })
    )

    const rows = await healthcheckImageHosts(c)
    expect(rows.find((row) => row.id === 'img:thesungod')).toMatchObject({
      status: 'failing',
      detail: 'Invalid API key'
    })
  })

  it('returns null on upload failure', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'gravlax-img-'))
    const file = path.join(dir, 'cover.jpg')
    await writeFile(file, JPEG)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })))
    expect(await uploadCoverImage(cfg(), 'imgbb', file)).toBeNull()
  })
})
