import { win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { defaultConfig, setFieldString, validate } from '@main/core/config'
import { normalizePath, pathKey } from '@main/core/config/paths'
import { openPathInShell } from '../openPath'

describe('Windows root paths', () => {
  it.each([
    ['drive', 'C:\\', 'C:\\'],
    ['drive with forward slash', 'C:/', 'C:\\'],
    ['network share', '\\\\server\\share\\', '\\\\server\\share\\'],
    ['network share without final slash', '\\\\server\\share', '\\\\server\\share\\']
  ])('keeps a %s root when normalizing settings', (_kind, input, expected) => {
    expect(normalizePath(input)).toBe(expected)
    expect(setFieldString(defaultConfig(), 'directories', 'source', input).directories.source).toBe(expected)
  })

  it('still removes extra slashes from paths below a root', () => {
    expect(normalizePath('C:\\Music\\\\')).toBe('C:\\Music')
  })
})

describe.skipIf(process.platform !== 'win32')('Windows paths', () => {
  it.each([
    ['drive', win32.join('C:\\', 'Music', 'workspace', 'upload-123')],
    ['network share', win32.join('\\\\server\\share', 'workspace', 'upload-123')]
  ])('opens the %s workspace folder without a parent segment', async (_kind, workspace) => {
    const openPath = vi.fn().mockResolvedValue('')

    await openPathInShell(`${win32.join(workspace, 'Album')}/..`, openPath)

    expect(openPath).toHaveBeenCalledExactlyOnceWith(workspace)
  })

  it('matches drive paths regardless of letter or folder case', () => {
    expect(pathKey('C:\\Music\\Album')).toBe(pathKey('c:\\music\\album'))
  })

  it.each(['C:\\', '\\\\server\\share\\'])('accepts %s as a source root', (root) => {
    const config = setFieldString(defaultConfig(), 'directories', 'source', root)
    expect(validate(config).filter((issue) => issue.field === 'source')).toEqual([])
  })
})
