import { describe, expect, it } from 'vitest'
import {
  extractHtmlErrorMessage,
  extractSiteUploadError,
  parseMostRecentTorrentAndGroupIdFromGroupPage,
  parseMostRecentTorrentAndGroupIdFromOpsGroupPage,
  parseTorrentIdFromFilledRequestPage,
  parseUploadFormPrefill
} from '../html'

describe('tracker html parsers', () => {
  it('parses RED group page torrent/group ids', () => {
    const html = `
      <a class="tooltip" href="torrents.php?torrentid=10">t</a>
      <a class="tooltip" href="torrents.php?torrentid=42">t</a>
      <a class="brackets" href="upload.php?groupid=7">[Add format]</a>
      <a class="brackets" href="upload.php?groupid=9">[Add format]</a>
    `
    expect(parseMostRecentTorrentAndGroupIdFromGroupPage(html)).toEqual({
      torrentId: 42,
      groupId: 9
    })
  })

  it('parses OPS group page permalink ids', () => {
    const html = `
      <a title="Permalink" href="torrents.php?id=5&torrentid=11">PL</a>
      <a title="Permalink" href="torrents.php?id=8&torrentid=22">PL</a>
    `
    expect(parseMostRecentTorrentAndGroupIdFromOpsGroupPage(html)).toEqual({
      torrentId: 22,
      groupId: 8
    })
  })

  it('parses filled request torrent id', () => {
    const html = `
      <a href="torrents.php?torrentid=3">No</a>
      <a href="torrents.php?torrentid=99">Yes</a>
    `
    expect(parseTorrentIdFromFilledRequestPage(html)).toBe(99)
  })

  it('scrapes upload form prefill fields', () => {
    const html = `
      <form>
        <input name="artists[]" value="Artist A" />
        <select name="importance[]">
          <option value="1">Main</option>
          <option value="2" selected>Guest</option>
        </select>
        <input name="artists[]" value="Artist B" />
        <select name="importance[]">
          <option value="1" selected>Main</option>
        </select>
        <input name="title" value="Album" />
        <input name="year" value="2020" />
        <input name="tags" value="rock, indie" />
        <input name="image" value="https://img/test.jpg" />
        <select name="releasetype">
          <option value="1">Album</option>
          <option value="5" selected>EP</option>
        </select>
        <textarea name="album_desc">Desc</textarea>
      </form>
    `
    expect(parseUploadFormPrefill(html)).toEqual({
      'artists[]': ['Artist A', 'Artist B'],
      'importance[]': [2, 1],
      title: 'Album',
      year: '2020',
      tags: 'rock, indie',
      image: 'https://img/test.jpg',
      releasetype: '5',
      album_desc: 'Desc'
    })
  })

  it('extracts site upload and html error messages', () => {
    expect(
      extractSiteUploadError(
        '<p style="color: red; text-align: center;">Duplicate torrent</p>'
      )
    ).toBe('Duplicate torrent')
    expect(
      extractHtmlErrorMessage(
        '<div><div><h2>Error</h2></div><div><p>Something broke</p></div></div>'
      )
    ).toBe('Something broke')
  })
})
