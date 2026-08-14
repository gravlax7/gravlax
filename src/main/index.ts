import { app, BrowserWindow, clipboard, dialog, protocol, shell } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, relative, resolve, isAbsolute } from 'node:path'
import { registerIpc } from './ipc'
import { UploadSession } from './services/uploadSession'
import { ConfigService } from './services/configService'
import { UploadStatsService } from './services/uploadStatsService'
import { workspaceRoot } from './core/appdata/workspace'
import { SystemToolResolver } from './core/tools/binaries'
import { checkForUpdate } from './services/updateCheck'
import { TorrentExportService } from './services/torrentExportService'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'gravlax-spectral',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      bypassCSP: true,
      stream: true,
      corsEnabled: true
    }
  }
])

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#0d0d0f',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        void shell.openExternal(parsed.toString())
      }
    } catch {
      /* ignore invalid urls */
    }
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  protocol.handle('gravlax-spectral', async (request) => {
    try {
      const url = new URL(request.url)
      const filePath = url.searchParams.get('path')
      if (!filePath) {
        return new Response('missing path', { status: 400 })
      }
      // Spectrals and cover art both live inside the workspace. Without this the
      // scheme is a general-purpose file reader for anything the renderer asks.
      const resolved = resolve(filePath)
      const root = workspaceRoot(app.getPath('userData'))
      const rel = relative(root, resolved)
      if (rel.startsWith('..') || isAbsolute(rel)) {
        return new Response('path outside workspace', { status: 403 })
      }
      const data = await readFile(resolved)
      const ext = extname(resolved).toLowerCase()
      const type =
        ext === '.png' ? 'image/png' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'application/octet-stream'
      return new Response(data, {
        headers: {
          'Content-Type': type,
          'Cache-Control': 'no-cache'
        }
      })
    } catch (err) {
      return new Response(String(err), { status: 404 })
    }
  })

  const configService = new ConfigService(app.getPath('userData'))
  await configService.ensureLoaded()
  const toolResolver = new SystemToolResolver(() => configService.get().tools)
  const send = (channel: string, payload: unknown): void => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    mainWindow.webContents.send(channel, payload)
  }
  const uploadStatsService = new UploadStatsService(app.getPath('userData'), (stats) => {
    send('stats:changed', stats)
  })

  const uploadSession = new UploadSession({
    appVersion: app.getVersion(),
    userDataPath: app.getPath('userData'),
    getConfig: () => configService.get(),
    tools: toolResolver,
    send,
    recordUploadStatistic: async (record) => {
      await uploadStatsService.record(record)
    }
  })
  const torrentExportService = new TorrentExportService({
    getUpload: () => uploadSession.getState().upload,
    pickSavePath: async (filename) => {
      const options: Electron.SaveDialogOptions = {
        defaultPath: join(app.getPath('downloads'), filename),
        filters: [{ name: 'Torrent files', extensions: ['torrent'] }]
      }
      const result = mainWindow
        ? await dialog.showSaveDialog(mainWindow, options)
        : await dialog.showSaveDialog(options)
      return result.canceled ? null : (result.filePath ?? null)
    },
    pickDirectory: async () => {
      const options: Electron.OpenDialogOptions = {
        defaultPath: app.getPath('downloads'),
        properties: ['openDirectory', 'createDirectory']
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, options)
        : await dialog.showOpenDialog(options)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  registerIpc({
    configService,
    uploadStatsService,
    uploadSession,
    toolResolver,
    saveTorrent: (submissionId) => torrentExportService.saveOne(submissionId),
    saveTorrents: () => torrentExportService.saveAll(),
    pickDirectory: async () => {
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory'] })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    pickFile: async (options) => {
      const dialogOptions: Electron.OpenDialogOptions = {
        properties: ['openFile'],
        filters: options?.filters
      }
      const result = mainWindow
        ? await dialog.showOpenDialog(mainWindow, dialogOptions)
        : await dialog.showOpenDialog(dialogOptions)
      return result.canceled ? null : (result.filePaths[0] ?? null)
    },
    revealPath: async (path) => {
      shell.showItemInFolder(path)
    },
    openPath: async (path) => {
      const error = await shell.openPath(path)
      if (error) throw new Error(error)
    },
    openExternal: async (url) => {
      const trimmed = String(url ?? '').trim()
      const parsed = new URL(trimmed)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('only http(s) URLs can be opened')
      }
      await shell.openExternal(parsed.toString())
    },
    writeClipboardText: (text) => clipboard.writeText(text),
    checkForUpdates: () => {
      const currentVersion = app.getVersion()
      if (!app.isPackaged) return Promise.resolve({ status: 'disabled', currentVersion })
      return checkForUpdate({ currentVersion })
    }
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  // Persisting is debounced; without this a quit inside the window loses the
  // last edit. `app.quit()` does not reliably restart a quit that this handler
  // cancelled, so end the process directly after the save completes.
  let savingBeforeQuit = false
  app.on('before-quit', (event) => {
    event.preventDefault()
    if (savingBeforeQuit) return
    savingBeforeQuit = true
    void uploadSession.flushPersist().finally(() => {
      app.exit(0)
    })
  })
})

app.on('window-all-closed', () => {
  app.quit()
})
