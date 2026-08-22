import { chmod, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import type { FilesRenamePlan, PlannedFileName } from '@shared/upload/naming'
import type { OriginalFileSnapshot, Release } from '@shared/types'
import { automaticToolResolver, type ToolResolver } from '../binaries'
import { runCommand } from '../runCommand'
import { finishStagedFolderRename, prepareStagedFolderRename, uploadWorkspaceRootForPath } from '../../appdata/workspace'

const MANAGED_KEYS = [
  'TITLE', 'ARTIST', 'COMPOSER', 'CONDUCTOR', 'TRACKNUMBER', 'TRACK NUMBER',
  'DISCNUMBER', 'DISC NUMBER', 'TRACKTOTAL', 'TOTALTRACKS', 'DISCTOTAL', 'TOTALDISCS',
  'ALBUM', 'ALBUMARTIST', 'ALBUM ARTIST', 'DATE', 'YEAR', 'LABEL',
  'CATALOGNUMBER', 'CATALOG NUMBER', 'CATNO', 'UPC', 'BARCODE', 'GENRE',
  'COMMENT', 'DESCRIPTION', 'COVERART', 'COVERARTMIME'
] as const

export interface ApplyFilesResult {
  workspacePath: string
  folderName: string
  currentPaths: Array<{ id: string; currentPath: string }>
  originals: OriginalFileSnapshot[]
  changedFileCount: number
  strippedPictureCount: number
}

export type FilesProgressCallback = (
  current: number,
  total: number,
  label: string
) => void

export async function captureOriginalFiles(
  workspacePath: string,
  files: Array<{ id: string; currentPath: string }>,
  signal?: AbortSignal,
  tools: ToolResolver = automaticToolResolver,
  onProgress?: FilesProgressCallback
): Promise<{ originals: OriginalFileSnapshot[]; pictureCount: number }> {
  const backupRoot = join(uploadWorkspaceRootForPath(workspacePath), '.gravlax-original-metadata')
  await mkdir(backupRoot, { recursive: true, mode: 0o700 })
  const originals: OriginalFileSnapshot[] = []
  let pictureCount = 0
  onProgress?.(0, files.length, 'Saving original tags…')
  for (const [index, file] of files.entries()) {
    onProgress?.(index, files.length, `Saving original tags: ${file.currentPath}`)
    const absolutePath = join(workspacePath, fromPosix(file.currentPath))
    const comments = await readManagedComments(absolutePath, signal, tools)
    const managedComments = comments.filter((comment) => !/^COVERART(?:MIME)?=/i.test(comment))
    const legacyCoverBackups: NonNullable<OriginalFileSnapshot['legacyCoverBackups']> = []
    for (const [legacyIndex, comment] of comments.filter((item) => /^COVERART(?:MIME)?=/i.test(item)).entries()) {
      const split = comment.indexOf('=')
      const key = comment.slice(0, split).toUpperCase() as 'COVERART' | 'COVERARTMIME'
      const relativePath = `${String(index + 1).padStart(3, '0')}-legacy-cover-${legacyIndex}.value`
      await writeFile(join(backupRoot, relativePath), comment.slice(split + 1), { encoding: 'utf8', mode: 0o600 })
      legacyCoverBackups.push({ key, relativePath })
    }
    const blocks = await pictureBlockNumbers(absolutePath, signal, tools)
    const pictureBackups: NonNullable<OriginalFileSnapshot['pictureBackups']> = []
    for (const blockNumber of blocks) {
      const relativePath = `${String(index + 1).padStart(3, '0')}-picture-${blockNumber}.block`
      const bytes = await runCommand('metaflac', ['--list', '--data-format=binary', `--block-number=${blockNumber}`, absolutePath], signal, undefined, tools)
      await writeFile(join(backupRoot, relativePath), bytes, { mode: 0o600 })
      pictureBackups.push({ blockNumber, relativePath })
      pictureCount += 1
    }
    originals.push({ id: file.id, relativePath: file.currentPath, managedComments, pictureBackups, legacyCoverBackups })
    onProgress?.(index + 1, files.length, `Saved original tags: ${file.currentPath}`)
  }
  return { originals, pictureCount }
}

export async function applyTagsAndRenames(input: {
  workspacePath: string
  release: Release
  plan: FilesRenamePlan
  originals: OriginalFileSnapshot[]
  stripEmbeddedCoverArt: boolean
  signal?: AbortSignal
  tools?: ToolResolver
  onProgress?: FilesProgressCallback
}): Promise<ApplyFilesResult> {
  const { release, plan, originals, signal } = input
  if (plan.errors.length > 0) throw new Error(plan.errors[0])
  if ((release.tracks?.length ?? 0) !== plan.files.length) {
    throw new Error('Track count changed before the files could be written.')
  }
  const progressTotal = plan.files.length + 1
  input.onProgress?.(0, progressTotal, 'Checking filenames…')
  await preflightFileRenames(input.workspacePath, plan.files)
  if (plan.folderName !== basename(input.workspacePath)) {
    await assertMissingOrSame(join(uploadWorkspaceRootForPath(input.workspacePath), plan.folderName), input.workspacePath)
  }
  let strippedPictureCount = 0
  for (const [index, file] of plan.files.entries()) {
    input.onProgress?.(index, progressTotal, `Applying tags: ${file.currentPath}`)
    const original = originals.find((item) => item.id === file.id)
    if (!original) throw new Error(`Missing original-state backup for ${file.currentPath}.`)
    const values = tagValues(release, index)
    if (!input.stripEmbeddedCoverArt) {
      await addLegacyCoverValues(values, original, uploadWorkspaceRootForPath(input.workspacePath))
    }
    const restorePictures = input.stripEmbeddedCoverArt ? [] : (original.pictureBackups ?? [])
    await rewriteFlac(join(input.workspacePath, fromPosix(file.currentPath)), values, restorePictures, uploadWorkspaceRootForPath(input.workspacePath), signal, input.tools ?? automaticToolResolver)
    if (input.stripEmbeddedCoverArt) {
      strippedPictureCount += original.pictureBackups?.length ?? 0
      strippedPictureCount += (original.legacyCoverBackups ?? []).filter((item) => item.key === 'COVERART').length
    }
    input.onProgress?.(index + 1, progressTotal, `Applied tags: ${file.currentPath}`)
  }

  input.onProgress?.(plan.files.length, progressTotal, 'Renaming files…')
  await renameFiles(input.workspacePath, plan.files)
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
    originals,
    changedFileCount: plan.files.filter((file) => file.changed).length,
    strippedPictureCount
  }
}

export async function restoreOriginalFiles(input: {
  workspacePath: string
  originals: OriginalFileSnapshot[]
  currentFiles: Array<{ id: string; currentPath: string }>
  originalFolderName: string
  signal?: AbortSignal
  tools?: ToolResolver
}): Promise<string> {
  const plans: PlannedFileName[] = input.currentFiles.map((current) => {
    const original = input.originals.find((item) => item.id === current.id)
    if (!original) throw new Error(`Missing original-state backup for ${current.currentPath}.`)
    return { id: current.id, currentPath: current.currentPath, targetPath: original.relativePath, targetFilename: basename(original.relativePath), changed: current.currentPath !== original.relativePath }
  })
  await renameFiles(input.workspacePath, plans)
  for (const original of input.originals) {
    const values = commentsToValues(original.managedComments ?? [])
    await addLegacyCoverValues(values, original, uploadWorkspaceRootForPath(input.workspacePath))
    await rewriteFlac(join(input.workspacePath, fromPosix(original.relativePath)), values, original.pictureBackups ?? [], uploadWorkspaceRootForPath(input.workspacePath), input.signal, input.tools ?? automaticToolResolver)
  }
  if (basename(input.workspacePath) === input.originalFolderName) return input.workspacePath
  const root = uploadWorkspaceRootForPath(input.workspacePath)
  const target = join(root, input.originalFolderName)
  await assertMissingOrSame(target, input.workspacePath)
  await prepareStagedFolderRename(root, basename(input.workspacePath), input.originalFolderName)
  await renameCaseSafe(input.workspacePath, target)
  try {
    await finishStagedFolderRename(root, input.originalFolderName)
  } catch (err) {
    await renameCaseSafe(target, input.workspacePath)
    await finishStagedFolderRename(root, basename(input.workspacePath))
    throw err
  }
  return target
}

async function rewriteFlac(
  sourcePath: string,
  values: Map<string, string[]>,
  pictureBackups: Array<{ blockNumber: number; relativePath: string }>,
  workspaceRoot: string,
  signal: AbortSignal | undefined,
  tools: ToolResolver
): Promise<void> {
  const sourceInfo = await stat(sourcePath)
  const workDir = await mkdtemp(join(dirname(sourcePath), '.gravlax-tags-'))
  const temporary = join(dirname(sourcePath), `.${basename(sourcePath)}.gravlax-${Date.now()}.flac`)
  try {
    const args = ['--no-utf8-convert', `--output-name=${temporary}`, ...MANAGED_KEYS.map((key) => `--remove-tag=${key}`)]
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
    await runCommand('metaflac', ['--dont-use-padding', '--remove', '--block-type=PICTURE', temporary], signal, undefined, tools)
    const backupRoot = join(workspaceRoot, '.gravlax-original-metadata')
    for (const picture of [...pictureBackups].sort((a, b) => a.blockNumber - b.blockNumber)) {
      const bytes = await readFile(join(backupRoot, picture.relativePath))
      await runCommand('metaflac', ['--append', temporary], signal, bytes, tools)
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
    await rm(temporary, { force: true })
  }
}

async function readManagedComments(
  path: string,
  signal?: AbortSignal,
  tools: ToolResolver = automaticToolResolver
): Promise<string[]> {
  const args = ['--no-utf8-convert', ...MANAGED_KEYS.map((key) => `--show-tag=${key}`), path]
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

function tagValues(release: Release, index: number): Map<string, string[]> {
  const track = release.tracks?.[index] ?? {}
  const discTotal = Math.max(1, ...(release.tracks ?? []).map((item) => Number.parseInt(item.discNumber ?? '1', 10) || 1))
  const main = trackArtistValue(track.artists)
  const composer = joinArtistRole(track.artists, 'composer')
  const conductor = joinArtistRole(track.artists, 'conductor')
  const album = [release.title, release.editionTitle ? `(${release.editionTitle})` : ''].filter(Boolean).join(' ')
  return cleanValues(new Map<string, string[]>([
    ['TITLE', one(track.title)], ['ARTIST', one(main)], ['COMPOSER', one(composer)], ['CONDUCTOR', one(conductor)],
    ['TRACKNUMBER', one(track.trackNumber)], ['DISCNUMBER', one(track.discNumber)],
    ['TRACKTOTAL', one(String(release.tracks?.length ?? 0))], ['DISCTOTAL', one(String(discTotal))],
    ['ALBUM', one(album)], ['ALBUMARTIST', one(release.albumArtist)], ['DATE', one(release.groupYear)],
    ['LABEL', one(release.label)], ['CATALOGNUMBER', one(release.catNo)], ['UPC', one(release.upc)],
    ['GENRE', one([...(release.genres ?? [])].sort((a, b) => a.localeCompare(b)).join('; '))],
    ['COMMENT', one(release.comment)]
  ]))
}

function trackArtistValue(artists: Release['artists']): string {
  const main = uniqueArtistNames(artists, 'main')
  const conductors = uniqueArtistNames(artists, 'conductor')
  const lead = [...new Set([...main, ...conductors])]
  let value = conductors.length > 0
    ? lead.join(', ')
    : joinArtistNames(lead)
  const guests = uniqueArtistNames(artists, 'guest')
  if (guests.length >= 4) value += ' (feat. Various)'
  else if (guests.length > 0) value += ` (feat. ${joinArtistNames(guests)})`
  return value
}

function joinArtistRole(artists: Release['artists'], role: string): string {
  return uniqueArtistNames(artists, role).join(', ')
}

function uniqueArtistNames(artists: Release['artists'], role: string): string[] {
  return [...new Set((artists ?? []).filter((artist) => (artist.role || 'main') === role).map((artist) => artist.name?.trim() ?? '').filter(Boolean))]
}

function joinArtistNames(names: string[]): string {
  const separator = names.length > 2 && !names.some((name) => name.includes('&')) ? ', ' : ' & '
  return names.join(separator)
}

function one(value?: string): string[] { return value ? [value] : [] }
function cleanValues(values: Map<string, string[]>): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const [key, items] of values) {
    const kept = items.filter((item) => item !== '')
    if (kept.length > 0) result.set(key, kept)
  }
  return result
}
function commentsToValues(comments: string[]): Map<string, string[]> {
  const result = new Map<string, string[]>()
  for (const comment of comments) {
    const split = comment.indexOf('=')
    if (split < 1) continue
    const key = comment.slice(0, split).toUpperCase()
    const value = comment.slice(split + 1)
    result.set(key, [...(result.get(key) ?? []), value])
  }
  return result
}
function valuesToComments(values: Map<string, string[]>): string[] {
  return [...values].flatMap(([key, items]) => items.map((value) => `${key}=${value}`))
}

async function addLegacyCoverValues(values: Map<string, string[]>, original: OriginalFileSnapshot, workspaceRoot: string): Promise<void> {
  const backupRoot = join(workspaceRoot, '.gravlax-original-metadata')
  for (const backup of original.legacyCoverBackups ?? []) {
    const value = await readFile(join(backupRoot, backup.relativePath), 'utf8')
    values.set(backup.key, [...(values.get(backup.key) ?? []), value])
  }
}
function sameComments(a: string[], b: string[]): boolean {
  const normalize = (items: string[]) => items.map((item) => `${item.slice(0, item.indexOf('=')).toUpperCase()}${item.slice(item.indexOf('='))}`).sort()
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b))
}

async function renameFiles(root: string, files: PlannedFileName[]): Promise<void> {
  const changed = files.filter((file) => file.changed)
  const sidecarMoves = await planSidecarMoves(root, files)
  const sources = new Set(changed.map((file) => join(root, fromPosix(file.currentPath)).toLocaleLowerCase()))
  for (const file of changed) {
    const target = join(root, fromPosix(file.targetPath))
    await mkdir(dirname(target), { recursive: true })
    try {
      await assertMissingOrSame(target, join(root, fromPosix(file.currentPath)))
    } catch (err) {
      if (!sources.has(target.toLocaleLowerCase())) throw err
    }
  }
  const temporary = new Map<string, string>()
  const placed: PlannedFileName[] = []
  const movedSidecars: Array<{ source: string; target: string }> = []
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
    for (const move of sidecarMoves) {
      await mkdir(dirname(move.target), { recursive: true })
      await rename(move.source, move.target)
      movedSidecars.push(move)
    }
  } catch (err) {
    for (const move of movedSidecars.reverse()) {
      await mkdir(dirname(move.source), { recursive: true })
      await rename(move.target, move.source).catch(() => undefined)
    }
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

async function preflightFileRenames(root: string, files: PlannedFileName[]): Promise<void> {
  const changed = files.filter((file) => file.changed)
  const sources = new Set(changed.map((file) => join(root, fromPosix(file.currentPath)).toLocaleLowerCase()))
  for (const file of changed) {
    const source = join(root, fromPosix(file.currentPath))
    await accessFile(source)
    const target = join(root, fromPosix(file.targetPath))
    try {
      await assertMissingOrSame(target, source)
    } catch (err) {
      if (!sources.has(target.toLocaleLowerCase())) throw err
    }
  }
  await planSidecarMoves(root, files)
}

async function planSidecarMoves(root: string, files: PlannedFileName[]): Promise<Array<{ source: string; target: string }>> {
  const mapping = new Map<string, Set<string>>()
  for (const file of files) {
    const sourceDir = dirname(file.currentPath).split(sep).join('/')
    const targetDir = dirname(file.targetPath).split(sep).join('/')
    if (sourceDir === '.' || sourceDir === targetDir) continue
    const targets = mapping.get(sourceDir) ?? new Set<string>()
    targets.add(targetDir)
    mapping.set(sourceDir, targets)
  }
  const moves: Array<{ source: string; target: string }> = []
  for (const [sourceDir, targets] of mapping) {
    if (targets.size !== 1) continue
    const targetDir = [...targets][0]!
    const entries = await readdir(join(root, fromPosix(sourceDir)), { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || extname(entry.name).toLowerCase() === '.flac') continue
      const source = join(root, fromPosix(sourceDir), entry.name)
      const target = join(root, fromPosix(targetDir), entry.name)
      await assertMissingOrSame(target, source)
      moves.push({ source, target })
    }
  }
  return moves
}

async function assertMissingOrSame(target: string, source: string): Promise<void> {
  if (target.toLocaleLowerCase() === source.toLocaleLowerCase()) return
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
  if (source !== target && source.toLocaleLowerCase() === target.toLocaleLowerCase()) {
    const temporary = `${source}.gravlax-case-${Date.now()}`
    await rename(source, temporary)
    await rename(temporary, target)
    return
  }
  await rename(source, target)
}

async function removeEmptyDirectories(root: string): Promise<void> {
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(root, entry.name)
    await removeEmptyDirectories(path)
    if ((await readdir(path)).length === 0) await rm(path, { recursive: true })
  }
}

function fromPosix(path: string): string { return path.split('/').join(sep) }
