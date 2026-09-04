import { chmod, mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, sep } from 'node:path'
import type { FilesRenamePlan, PlannedFileName, PlannedPayloadPath } from '@shared/upload/naming'
import type { Release } from '@shared/types'
import { automaticToolResolver, type ToolResolver } from '../binaries'
import { removeEmptyDirectories } from '../directories'
import { runCommand } from '../runCommand'
import { finishStagedFolderRename, prepareStagedFolderRename, uploadWorkspaceRootForPath } from '../../appdata/workspace'
import { managedRemovalKeys, managedTagProjection } from '@shared/tags/projection'

const MANAGED_TAG_KEYS = managedRemovalKeys()
const COVER_KEYS = ['COVERART', 'COVERARTMIME']

export interface ApplyFilesResult {
  workspacePath: string
  folderName: string
  currentPaths: Array<{ id: string; currentPath: string }>
  payloadPaths: Array<{ id: string; currentPath: string }>
  changedFileCount: number
  strippedPictureCount: number
}

export type FilesProgressCallback = (
  current: number,
  total: number,
  label: string
) => void

export async function applyTagsAndRenames(input: {
  workspacePath: string
  release: Release
  plan: FilesRenamePlan
  stripEmbeddedCoverArt: boolean
  signal?: AbortSignal
  tools?: ToolResolver
  onProgress?: FilesProgressCallback
}): Promise<ApplyFilesResult> {
  const { release, plan, signal } = input
  const tools = input.tools ?? automaticToolResolver
  if (plan.errors.length > 0) throw new Error(plan.errors[0])
  if ((release.tracks?.length ?? 0) !== plan.files.length) {
    throw new Error('Track count changed before the files could be written.')
  }
  const progressTotal = plan.files.length + 1
  const payloadFiles = plan.payloadFiles ?? plan.files.map(trackAsPayload)
  input.onProgress?.(0, progressTotal, 'Checking filenames…')
  await preflightFileRenames(input.workspacePath, payloadFiles)
  if (plan.folderName !== basename(input.workspacePath)) {
    await assertMissingOrSame(join(uploadWorkspaceRootForPath(input.workspacePath), plan.folderName), input.workspacePath)
  }
  let strippedPictureCount = 0
  for (const [index, file] of plan.files.entries()) {
    input.onProgress?.(index, progressTotal, `Applying tags: ${file.currentPath}`)
    const absolutePath = join(input.workspacePath, fromPosix(file.currentPath))
    const values = await tagValues(release, index, absolutePath, signal, tools)
    if (input.stripEmbeddedCoverArt) {
      strippedPictureCount += await countEmbeddedCoverArt(absolutePath, signal, tools)
    }
    await rewriteFlac(absolutePath, values, input.stripEmbeddedCoverArt, signal, tools)
    input.onProgress?.(index + 1, progressTotal, `Applied tags: ${file.currentPath}`)
  }

  input.onProgress?.(plan.files.length, progressTotal, 'Renaming files…')
  await renameFiles(input.workspacePath, payloadFiles)
  let workspacePath = input.workspacePath
  if (plan.folderName !== basename(workspacePath)) {
    const root = uploadWorkspaceRootForPath(workspacePath)
    const target = join(root, plan.folderName)
    await assertMissingOrSame(target, workspacePath)
    await prepareStagedFolderRename(root, basename(workspacePath), plan.folderName)
    await renameCaseSafe(workspacePath, target)
    try {
      await finishStagedFolderRename(root, plan.folderName)
    } catch (err) {
      await renameCaseSafe(target, workspacePath)
      await finishStagedFolderRename(root, basename(workspacePath))
      throw err
    }
    workspacePath = target
  }
  input.onProgress?.(progressTotal, progressTotal, 'Finishing…')
  return {
    workspacePath,
    folderName: basename(workspacePath),
    currentPaths: plan.files.map((file) => ({ id: file.id, currentPath: file.targetPath })),
    payloadPaths: payloadFiles.map((file) => ({ id: file.id, currentPath: file.targetPath })),
    changedFileCount: payloadFiles.filter((file) => file.changed).length,
    strippedPictureCount
  }
}

async function rewriteFlac(
  sourcePath: string,
  values: Map<string, string[]>,
  stripCover: boolean,
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<void> {
  const sourceInfo = await stat(sourcePath)
  const workDir = await mkdtemp(join(dirname(sourcePath), '.gravlax-tags-'))
  const temporary = join(workDir, 'output.flac')
  try {
    const removeKeys = stripCover ? [...MANAGED_TAG_KEYS, ...COVER_KEYS] : MANAGED_TAG_KEYS
    const args = ['--no-utf8-convert', `--output-name=${temporary}`, ...removeKeys.map((key) => `--remove-tag=${key}`)]
    let valueIndex = 0
    for (const [key, items] of values) {
      for (const value of items) {
        const valuePath = join(workDir, String(valueIndex++))
        await writeFile(valuePath, value, { encoding: 'utf8', mode: 0o600 })
        args.push(`--set-tag-from-file=${key}=${valuePath}`)
      }
    }
    args.push(sourcePath)
    await runCommand('metaflac', args, signal, undefined, tools)
    if (stripCover) {
      await runCommand('metaflac', ['--dont-use-padding', '--remove', '--block-type=PICTURE', temporary], signal, undefined, tools)
    }
    await runCommand('flac', ['-t', '--silent', temporary], signal, undefined, tools)
    const actual = await readManagedComments(temporary, signal, tools)
    const expected = valuesToComments(values)
    if (!sameComments(actual, expected)) throw new Error(`Tag verification failed for ${basename(sourcePath)}.`)
    await chmod(temporary, sourceInfo.mode)
    await utimes(temporary, sourceInfo.atime, sourceInfo.mtime)
    await rename(temporary, sourcePath)
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

async function readManagedComments(
  path: string,
  signal?: AbortSignal,
  tools: ToolResolver = automaticToolResolver
): Promise<string[]> {
  const args = ['--no-utf8-convert', ...MANAGED_TAG_KEYS.map((key) => `--show-tag=${key}`), path]
  const output = (await runCommand('metaflac', args, signal, undefined, tools)).toString('utf8')
  const comments: string[] = []
  for (const line of output.replace(/\r\n/g, '\n').split('\n')) {
    if (/^[^=\n]+=/.test(line)) comments.push(line)
    else if (comments.length > 0 && line !== '') comments[comments.length - 1] += `\n${line}`
  }
  return comments
}

async function pictureBlockNumbers(
  path: string,
  signal?: AbortSignal,
  tools: ToolResolver = automaticToolResolver
): Promise<number[]> {
  const output = (await runCommand('metaflac', ['--list', path], signal, undefined, tools)).toString('utf8')
  const numbers: number[] = []
  let block: number | undefined
  for (const line of output.split(/\r?\n/)) {
    const header = /^METADATA block #(\d+)/.exec(line)
    if (header) block = Number(header[1])
    if (/type:\s+6 \(PICTURE\)/.test(line) && block !== undefined) numbers.push(block)
  }
  return numbers
}

async function countEmbeddedCoverArt(
  path: string,
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<number> {
  const pictures = await pictureBlockNumbers(path, signal, tools)
  const output = (await runCommand(
    'metaflac',
    ['--no-utf8-convert', '--show-tag=COVERART', path],
    signal,
    undefined,
    tools
  )).toString('utf8')
  const covers = output.replace(/\r\n/g, '\n').split('\n').filter((line) => /^COVERART=/i.test(line)).length
  return pictures.length + covers
}

async function tagValues(
  release: Release,
  index: number,
  path: string,
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<Map<string, string[]>> {
  const values = managedTagProjection(release, index)
  if (values.has('ARTIST')) return values
  const comments = await readManagedComments(path, signal, tools)
  const artist = originalCommentValues(comments, 'ARTIST')
  if (artist.length > 0) values.set('ARTIST', artist)
  return values
}

function originalCommentValues(comments: string[], key: string): string[] {
  const prefix = `${key.toUpperCase()}=`
  return comments.flatMap((comment) => {
    const split = comment.indexOf('=')
    if (split < 0 || `${comment.slice(0, split).toUpperCase()}=` !== prefix) return []
    return [comment.slice(split + 1)]
  })
}

function valuesToComments(values: Map<string, string[]>): string[] {
  return [...values].flatMap(([key, items]) => items.map((value) => `${key}=${value}`))
}

function sameComments(a: string[], b: string[]): boolean {
  const normalize = (items: string[]) => items.map((item) => `${item.slice(0, item.indexOf('=')).toUpperCase()}${item.slice(item.indexOf('=')).normalize('NFC')}`).sort()
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

type RenamePlan = Pick<PlannedFileName, 'id' | 'currentPath' | 'targetPath' | 'changed'>

async function renameFiles(root: string, files: RenamePlan[]): Promise<void> {
  const changed = files.filter((file) => file.changed)
  const sources = new Set(changed.map((file) => filesystemPathKey(join(root, fromPosix(file.currentPath)))))
  for (const file of changed) {
    const target = join(root, fromPosix(file.targetPath))
    await mkdir(dirname(target), { recursive: true })
    try {
      await assertMissingOrSame(target, join(root, fromPosix(file.currentPath)))
    } catch (err) {
      if (!sources.has(filesystemPathKey(target))) throw err
    }
  }
  const temporary = new Map<string, string>()
  const placed: RenamePlan[] = []
  try {
    for (const [index, file] of changed.entries()) {
      const source = join(root, fromPosix(file.currentPath))
      const temp = join(root, `.gravlax-rename-${index}-${Date.now()}${extname(source)}`)
      await rename(source, temp)
      temporary.set(file.id, temp)
    }
    for (const file of changed) {
      await rename(temporary.get(file.id)!, join(root, fromPosix(file.targetPath)))
      temporary.delete(file.id)
      placed.push(file)
    }
  } catch (err) {
    for (const file of placed.reverse()) {
      const source = join(root, fromPosix(file.currentPath))
      await mkdir(dirname(source), { recursive: true })
      await rename(join(root, fromPosix(file.targetPath)), source).catch(() => undefined)
    }
    for (const file of changed) {
      const temp = temporary.get(file.id)
      if (!temp) continue
      const source = join(root, fromPosix(file.currentPath))
      await mkdir(dirname(source), { recursive: true })
      await rename(temp, source).catch(() => undefined)
    }
    throw err
  }
  await removeEmptyDirectories(root)
}

async function preflightFileRenames(root: string, files: RenamePlan[]): Promise<void> {
  const changed = files.filter((file) => file.changed)
  const sources = new Set(changed.map((file) => filesystemPathKey(join(root, fromPosix(file.currentPath)))))
  for (const file of changed) {
    const source = join(root, fromPosix(file.currentPath))
    await accessFile(source)
    const target = join(root, fromPosix(file.targetPath))
    try {
      await assertMissingOrSame(target, source)
    } catch (err) {
      if (!sources.has(filesystemPathKey(target))) throw err
    }
  }
}

function trackAsPayload(file: PlannedFileName): PlannedPayloadPath {
  return {
    id: file.id,
    kind: 'file',
    currentPath: file.currentPath,
    targetPath: file.targetPath,
    targetName: file.targetFilename,
    changed: file.changed,
    track: true
  }
}

async function assertMissingOrSame(target: string, source: string): Promise<void> {
  if (filesystemPathKey(target) === filesystemPathKey(source)) return
  try { await stat(target) } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
    throw err
  }
  throw new Error(`${target} already exists.`)
}

async function accessFile(path: string): Promise<void> {
  const info = await stat(path)
  if (!info.isFile()) throw new Error(`${path} is not a file.`)
}

async function renameCaseSafe(source: string, target: string): Promise<void> {
  if (source !== target && filesystemPathKey(source) === filesystemPathKey(target)) {
    const temporary = `${source}.gravlax-case-${Date.now()}`
    await rename(source, temporary)
    await rename(temporary, target)
    return
  }
  await rename(source, target)
}

function filesystemPathKey(path: string): string {
  return path.normalize('NFC').toLocaleLowerCase()
}

function fromPosix(path: string): string { return path.split('/').join(sep) }
