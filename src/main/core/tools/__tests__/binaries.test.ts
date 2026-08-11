import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolsConfig } from '@shared/types/config'
import { SystemToolResolver, toolSearchDirectories } from '../binaries'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('SystemToolResolver', () => {
  it('uses an authoritative configured executable before PATH', async () => {
    const root = await testRoot()
    const override = await executable(join(root, 'custom sox'))
    await executable(join(root, 'bin', 'sox'))
    const tools = emptyTools()
    tools.sox = override
    const resolver = new SystemToolResolver(() => tools, {
      platform: 'linux',
      env: { PATH: join(root, 'bin') },
      homeDirectory: root
    })

    expect(await resolver.resolve('sox')).toEqual({
      status: 'available',
      path: override,
      source: 'override'
    })
  })

  it('does not fall back when a configured executable is invalid', async () => {
    const root = await testRoot()
    await executable(join(root, 'bin', 'sox'))
    const tools = emptyTools()
    tools.sox = join(root, 'missing')
    const resolver = new SystemToolResolver(() => tools, {
      platform: 'linux',
      env: { PATH: join(root, 'bin') },
      homeDirectory: root
    })

    await expect(resolver.resolve('sox')).resolves.toMatchObject({
      status: 'missing',
      configuredPath: join(root, 'missing')
    })
    await expect(resolver.require('sox')).rejects.toThrow('Configured executable')
  })

  it('rejects a relative override even if the config file was edited by hand', async () => {
    const tools = emptyTools()
    tools.sox = 'tools/sox'
    const runnable = vi.fn(async () => true)
    const resolver = new SystemToolResolver(() => tools, {
      platform: 'linux',
      env: {},
      homeDirectory: '/home/ben',
      isRunnable: runnable
    })

    await expect(resolver.resolve('sox')).resolves.toEqual({
      status: 'missing',
      configuredPath: 'tools/sox',
      reason: 'Configured executable path must be absolute: tools/sox'
    })
    expect(runnable).not.toHaveBeenCalled()
  })

  it('prefers inherited PATH, accepts symlinks, and rejects directories', async () => {
    const root = await testRoot()
    const target = await executable(join(root, 'target'))
    const bin = join(root, 'bin')
    await mkdir(bin)
    await symlink(target, join(bin, 'flac'))
    await mkdir(join(bin, 'sox'))
    const resolver = new SystemToolResolver(emptyTools, {
      platform: 'linux',
      env: { PATH: `${bin}:${bin}` },
      homeDirectory: root
    })

    await expect(resolver.resolve('flac')).resolves.toEqual({
      status: 'available',
      path: join(bin, 'flac'),
      source: 'path'
    })
    await expect(resolver.resolve('sox')).resolves.toMatchObject({ status: 'missing' })
  })

  it('expands a tilde in an override', async () => {
    const root = await testRoot()
    await executable(join(root, 'tools', 'lame'))
    const tools = emptyTools()
    tools.lame = '~/tools/lame'
    const resolver = new SystemToolResolver(() => tools, {
      platform: 'darwin',
      env: {},
      homeDirectory: root
    })

    await expect(resolver.require('lame')).resolves.toBe(join(root, 'tools', 'lame'))
  })

  it('handles Windows environment casing and native executable suffixes', async () => {
    const runnable = vi.fn(async (path: string) => path === 'C:\\Tools\\sox.exe')
    const resolver = new SystemToolResolver(emptyTools, {
      platform: 'win32',
      env: { Path: 'C:\\Tools', PathExt: '.BAT;.EXE;.COM' },
      homeDirectory: 'C:\\Users\\Ben',
      isRunnable: runnable
    })

    await expect(resolver.resolve('sox')).resolves.toEqual({
      status: 'available',
      path: 'C:\\Tools\\sox.exe',
      source: 'path'
    })
    expect(runnable).not.toHaveBeenCalledWith('C:\\Tools\\sox.bat', 'win32')
  })

  it('invalidates cached paths when overrides change and on refresh', async () => {
    const tools = emptyTools()
    const runnable = vi.fn(async (path: string) => path !== '/missing')
    const resolver = new SystemToolResolver(() => tools, {
      platform: 'linux',
      env: { PATH: '/bin' },
      homeDirectory: '/home/ben',
      isRunnable: runnable
    })

    await resolver.resolve('flac')
    const callsAfterFirst = runnable.mock.calls.length
    await resolver.resolve('flac')
    expect(runnable).toHaveBeenCalledTimes(callsAfterFirst)
    await resolver.resolve('flac', { refresh: true })
    expect(runnable.mock.calls.length).toBeGreaterThan(callsAfterFirst)

    tools.flac = '/missing'
    await expect(resolver.resolve('flac')).resolves.toMatchObject({ status: 'missing' })
  })
})

describe('toolSearchDirectories', () => {
  it('adds macOS and Linux standard locations after inherited PATH', () => {
    expect(toolSearchDirectories('darwin', { PATH: '/custom:/usr/local/bin' }, '/Users/ben')).toEqual([
      '/custom',
      '/usr/local/bin',
      '/opt/homebrew/bin',
      '/opt/local/bin',
      '/Users/ben/.cargo/bin'
    ])
    expect(toolSearchDirectories('linux', { PATH: '/custom' }, '/home/ben')).toContain(
      '/home/linuxbrew/.linuxbrew/bin'
    )
  })

  it('adds Windows package-manager locations and deduplicates without case sensitivity', () => {
    expect(
      toolSearchDirectories(
        'win32',
        {
          Path: 'C:\\Tools;C:\\TOOLS',
          LOCALAPPDATA: 'C:\\Users\\Ben\\AppData\\Local',
          userprofile: 'C:\\Users\\Ben',
          ProgramData: 'C:\\ProgramData',
          ChocolateyInstall: 'C:\\Chocolatey'
        },
        'C:\\Fallback'
      )
    ).toEqual([
      'C:\\Tools',
      'C:\\Users\\Ben\\.cargo\\bin',
      'C:\\Users\\Ben\\scoop\\shims',
      'C:\\Users\\Ben\\AppData\\Local\\Microsoft\\WinGet\\Links',
      'C:\\Chocolatey\\bin',
      'C:\\ProgramData\\chocolatey\\bin'
    ])
  })
})

function emptyTools(): ToolsConfig {
  return { sox: '', flac: '', metaflac: '', mp3val: '', lame: '' }
}

async function testRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'gravlax-tools-'))
  roots.push(root)
  return root
}

async function executable(path: string): Promise<string> {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, '')
  await chmod(path, 0o755)
  return path
}
