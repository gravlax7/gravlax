import { win32 } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { openPathInShell } from '../openPath'

describe('opening a path in the system file manager', () => {
  it('opens the parent workspace folder on Windows without a dot segment', async () => {
    const openPath = vi.fn().mockResolvedValue('')
    const release = win32.join('C:\\Users', 'Music', 'workspace', 'upload-123', 'Album')

    await openPathInShell(`${release}/..`, openPath, 'win32')

    expect(openPath).toHaveBeenCalledExactlyOnceWith(
      win32.join('C:\\Users', 'Music', 'workspace', 'upload-123')
    )
  })

  it.each(['darwin', 'linux'] as const)('keeps the correct parent workspace folder on %s', async (platform) => {
    const openPath = vi.fn().mockResolvedValue('')

    await openPathInShell('/Users/me/workspace/upload-123/Album/..', openPath, platform)

    expect(openPath).toHaveBeenCalledExactlyOnceWith('/Users/me/workspace/upload-123')
  })

  it('reports an error when the system cannot open the folder', async () => {
    const openPath = vi.fn().mockResolvedValue('Failed to open path')

    await expect(openPathInShell('C:\\workspace\\Album/..', openPath, 'win32')).rejects.toThrow(
      'Failed to open path'
    )
  })
})
