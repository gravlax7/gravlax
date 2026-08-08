import { parse } from 'node-html-parser'

export function parseMostRecentTorrentAndGroupIdFromGroupPage(
  text: string
): { torrentId: number; groupId: number } {
  const root = parse(text)
  const torrentIds: number[] = []
  const groupIds: number[] = []

  for (const anchor of root.querySelectorAll('a.tooltip')) {
    const href = anchor.getAttribute('href') ?? ''
    const match = /torrents\.php\?torrentid=(\d+)/.exec(href)
    if (match) torrentIds.push(Number(match[1]))
  }
  for (const anchor of root.querySelectorAll('a.brackets')) {
    const href = anchor.getAttribute('href') ?? ''
    const match = /upload\.php\?groupid=(\d+)/.exec(href)
    if (match) groupIds.push(Number(match[1]))
  }

  if (torrentIds.length === 0 || groupIds.length === 0) {
    throw new Error('Could not parse torrent/group id from group page')
  }
  return { torrentId: Math.max(...torrentIds), groupId: Math.max(...groupIds) }
}

export function parseMostRecentTorrentAndGroupIdFromOpsGroupPage(
  text: string
): { torrentId: number; groupId: number } {
  const root = parse(text)
  const ids: Array<{ torrentId: number; groupId: number }> = []
  for (const anchor of root.querySelectorAll('a[title="Permalink"]')) {
    const href = anchor.getAttribute('href') ?? ''
    const match = /torrents\.php\?id=(\d+)&torrentid=(\d+)/.exec(href)
    if (match) {
      ids.push({ groupId: Number(match[1]), torrentId: Number(match[2]) })
    }
  }
  if (ids.length === 0) {
    throw new Error('Could not parse torrent/group id from group page: no permalink ids found')
  }
  return ids.reduce((best, cur) => (cur.torrentId > best.torrentId ? cur : best))
}

export function parseTorrentIdFromFilledRequestPage(text: string): number {
  const root = parse(text)
  const torrentIds: number[] = []
  for (const anchor of root.querySelectorAll('a')) {
    if ((anchor.textContent ?? '').trim() !== 'Yes') continue
    const href = anchor.getAttribute('href') ?? ''
    const match = /torrents\.php\?torrentid=(\d+)/.exec(href)
    if (match) torrentIds.push(Number(match[1]))
  }
  if (torrentIds.length === 0) {
    throw new Error('Could not parse torrent id from filled request page')
  }
  return Math.max(...torrentIds)
}

export function parseUploadFormPrefill(text: string): TrackerUploadFormPrefill {
  const root = parse(text)
  const prefill: TrackerUploadFormPrefill = {}

  const artistNames: string[] = []
  const artistImportances: number[] = []
  for (const input of root.querySelectorAll('input[name="artists[]"]')) {
    const name = input.getAttribute('value') ?? ''
    if (!name) continue
    let importance = 1
    let sibling = input.nextElementSibling
    while (sibling) {
      if (sibling.tagName === 'SELECT' && sibling.getAttribute('name') === 'importance[]') {
        const selected = sibling.querySelector('option[selected]')
        const val = selected?.getAttribute('value') ?? ''
        if (val) importance = Number(val)
        break
      }
      sibling = sibling.nextElementSibling
    }
    artistNames.push(name)
    artistImportances.push(importance)
  }
  if (artistNames.length > 0) {
    prefill['artists[]'] = artistNames
    prefill['importance[]'] = artistImportances
  }

  for (const field of ['title', 'year', 'tags', 'image'] as const) {
    const input = root.querySelector(`input[name="${field}"]`)
    const val = input?.getAttribute('value') ?? ''
    if (val) prefill[field] = val
  }

  const releaseSelected = root.querySelector('select[name="releasetype"] option[selected]')
  const releaseType = releaseSelected?.getAttribute('value') ?? ''
  if (releaseType) prefill.releasetype = releaseType

  const albumDesc = root.querySelector('textarea[name="album_desc"]')?.textContent ?? ''
  if (albumDesc) prefill.album_desc = albumDesc

  return prefill
}

export function extractSiteUploadError(text: string): string | null {
  const match = /<p style="color: red; text-align: center;">(.+)<\/p>/.exec(text)
  return match?.[1] ?? null
}

export function extractHtmlErrorMessage(text: string): string | null {
  const root = parse(text)
  const heading = root.querySelectorAll('h2').find((node) => node.text.trim() === 'Error')
  if (!heading) return null
  let node: typeof heading | null = heading
  for (let depth = 0; depth < 4 && node; depth++) {
    const paragraph = node.querySelector?.('p')
    const message = paragraph?.text?.trim()
    if (message) return message
    node = node.parentNode as typeof heading | null
  }
  return null
}

export type TrackerUploadFormPrefill = {
  'artists[]'?: string[]
  'importance[]'?: number[]
  title?: string
  year?: string
  tags?: string
  image?: string
  releasetype?: string
  album_desc?: string
}
