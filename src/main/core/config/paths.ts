import { homedir } from 'os'
import { isAbsolute, normalize, relative, resolve, sep } from 'path'

export function pathsOverlap(left: string, right: string): boolean {
  return isInside(relative(left, right)) || isInside(relative(right, left))
}

function isInside(path: string): boolean {
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

export function pathKey(path: string): string {
  const key = normalize(resolve(path))
  return process.platform === 'win32' ? key.toLowerCase() : key
}

export function expandPath(path: string): { path: string; ok: boolean } {
  if (path === '') {
    return { path: '', ok: true }
  }
  if (path === '~') {
    try {
      return { path: homedir(), ok: true }
    } catch {
      return { path: '', ok: false }
    }
  }
  const prefix = `~${sep}`
  if (path.startsWith(prefix) || path.startsWith('~/')) {
    try {
      const home = homedir()
      const rest = path.startsWith(prefix) ? path.slice(prefix.length) : path.slice(2)
      return { path: `${home}${sep}${rest}`, ok: true }
    } catch {
      return { path: '', ok: false }
    }
  }
  return { path, ok: true }
}

export function normalizePath(path: string): string {
  path = path.trim()
  if (path === '') {
    return ''
  }
  while (path.length > 1 && (path.endsWith('/') || path.endsWith('\\'))) {
    const trimmed = path.replace(/[/\\]+$/, '')
    if (trimmed === '') {
      return sep
    }
    path = trimmed
  }
  return path
}
