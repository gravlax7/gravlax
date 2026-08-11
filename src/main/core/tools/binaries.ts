import { constants } from 'node:fs'
import { access, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'
import type { ToolsConfig } from '@shared/types/config'

export const TOOL_IDS = ['sox', 'flac', 'metaflac', 'mp3val', 'lame'] as const
export type ToolId = (typeof TOOL_IDS)[number]

export type ToolResolution =
  | { status: 'available'; path: string; source: 'override' | 'path' | 'standard' }
  | { status: 'missing'; reason: string; configuredPath?: string }

export interface ToolResolver {
  resolve(id: ToolId, options?: { refresh?: boolean }): Promise<ToolResolution>
  require(id: ToolId): Promise<string>
}

interface SystemToolResolverOptions {
  platform?: NodeJS.Platform
  env?: NodeJS.ProcessEnv
  homeDirectory?: string
  isRunnable?: (path: string, platform: NodeJS.Platform) => Promise<boolean>
}

export class SystemToolResolver implements ToolResolver {
  private readonly platform: NodeJS.Platform
  private readonly env: NodeJS.ProcessEnv
  private readonly homeDirectory: string
  private readonly isRunnable: (path: string, platform: NodeJS.Platform) => Promise<boolean>
  private readonly cache = new Map<ToolId, { key: string; resolution: ToolResolution }>()

  constructor(
    private readonly getConfig: () => ToolsConfig,
    options: SystemToolResolverOptions = {}
  ) {
    this.platform = options.platform ?? process.platform
    this.env = options.env ?? process.env
    this.homeDirectory = options.homeDirectory ?? homedir()
    this.isRunnable = options.isRunnable ?? runnableFile
  }

  async resolve(id: ToolId, options: { refresh?: boolean } = {}): Promise<ToolResolution> {
    const configured = this.getConfig()[id].trim()
    const directories = toolSearchDirectories(this.platform, this.env, this.homeDirectory)
    const pathApi = this.platform === 'win32' ? win32 : posix
    const key = `${configured}\0${directories.join('\0')}`
    if (!options.refresh) {
      const cached = this.cache.get(id)
      if (cached?.key === key) return cached.resolution
    }
    this.cache.delete(id)

    if (configured !== '') {
      const path = expandHome(configured, this.platform, this.homeDirectory)
      if (!pathApi.isAbsolute(path)) {
        return {
          status: 'missing',
          configuredPath: path,
          reason: `Configured executable path must be absolute: ${path}`
        }
      }
      if (await this.isRunnable(path, this.platform)) {
        const resolution: ToolResolution = { status: 'available', path, source: 'override' }
        this.cache.set(id, { key, resolution })
        return resolution
      }
      return {
        status: 'missing',
        configuredPath: path,
        reason: `Configured executable is not a runnable file: ${path}`
      }
    }

    const inheritedCount = inheritedPathDirectories(this.platform, this.env).length
    const names = executableNames(id, this.platform, this.env)
    for (let directoryIndex = 0; directoryIndex < directories.length; directoryIndex++) {
      const directory = directories[directoryIndex]!
      for (const name of names) {
        const path = pathApi.join(directory, name)
        if (!(await this.isRunnable(path, this.platform))) continue
        const resolution: ToolResolution = {
          status: 'available',
          path,
          source: directoryIndex < inheritedCount ? 'path' : 'standard'
        }
        this.cache.set(id, { key, resolution })
        return resolution
      }
    }

    return {
      status: 'missing',
      reason: `Could not find ${id} in PATH or common install locations.`
    }
  }

  async require(id: ToolId): Promise<string> {
    const resolution = await this.resolve(id)
    if (resolution.status === 'available') return resolution.path
    throw new Error(resolution.reason)
  }
}

const AUTOMATIC_CONFIG: ToolsConfig = {
  sox: '',
  flac: '',
  metaflac: '',
  mp3val: '',
  lame: ''
}

export const automaticToolResolver: ToolResolver = new SystemToolResolver(() => AUTOMATIC_CONFIG)

export function toolSearchDirectories(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  homeDirectory: string
): string[] {
  const inherited = inheritedPathDirectories(platform, env)
  const pathApi = platform === 'win32' ? win32 : posix
  const standard: string[] = []

  if (platform === 'darwin') {
    standard.push('/opt/homebrew/bin', '/usr/local/bin', '/opt/local/bin')
    if (homeDirectory) standard.push(pathApi.join(homeDirectory, '.cargo', 'bin'))
  } else if (platform === 'linux') {
    standard.push('/usr/local/bin', '/usr/bin', '/bin', '/snap/bin')
    if (homeDirectory) {
      standard.push(pathApi.join(homeDirectory, '.local', 'bin'))
      standard.push(pathApi.join(homeDirectory, '.cargo', 'bin'))
    }
    standard.push('/home/linuxbrew/.linuxbrew/bin')
  } else if (platform === 'win32') {
    const userProfile = envValue(env, 'USERPROFILE') ?? homeDirectory
    if (userProfile) {
      standard.push(pathApi.join(userProfile, '.cargo', 'bin'))
      standard.push(pathApi.join(userProfile, 'scoop', 'shims'))
    }
    const localAppData = envValue(env, 'LOCALAPPDATA')
    if (localAppData) standard.push(pathApi.join(localAppData, 'Microsoft', 'WinGet', 'Links'))
    const chocolateyInstall = envValue(env, 'ChocolateyInstall')
    if (chocolateyInstall) standard.push(pathApi.join(chocolateyInstall, 'bin'))
    const programData = envValue(env, 'ProgramData')
    if (programData) standard.push(pathApi.join(programData, 'chocolatey', 'bin'))
  }

  return dedupeDirectories([...inherited, ...standard], platform)
}

function inheritedPathDirectories(platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  const value = envValue(env, 'PATH') ?? ''
  const delimiter = platform === 'win32' ? win32.delimiter : posix.delimiter
  return dedupeDirectories(
    value
      .split(delimiter)
      .map((part) => part.trim().replace(/^"(.*)"$/, '$1'))
      .filter(Boolean),
    platform
  )
}

function executableNames(id: ToolId, platform: NodeJS.Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform !== 'win32') return [id]
  const extensions = (envValue(env, 'PATHEXT') ?? '.EXE;.COM')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension === '.exe' || extension === '.com')
  return [...new Set((extensions.length > 0 ? extensions : ['.exe', '.com']).map((ext) => `${id}${ext}`))]
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase())
  return key ? env[key] : undefined
}

function dedupeDirectories(directories: string[], platform: NodeJS.Platform): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const directory of directories) {
    if (!directory) continue
    const key = platform === 'win32' ? directory.toLowerCase() : directory
    if (seen.has(key)) continue
    seen.add(key)
    result.push(directory)
  }
  return result
}

function expandHome(value: string, platform: NodeJS.Platform, homeDirectory: string): string {
  const trimmed = value.trim()
  if (trimmed === '~') return homeDirectory
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
    const pathApi = platform === 'win32' ? win32 : posix
    return pathApi.join(homeDirectory, trimmed.slice(2))
  }
  return trimmed
}

async function runnableFile(path: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return false
    await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK)
    return true
  } catch {
    return false
  }
}
