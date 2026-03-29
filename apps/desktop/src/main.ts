import path from 'node:path'
import {
  clearDesktopProviderConnection,
  getDesktopProviderConnections,
  safeRunDesktopLocalCliChat,
  saveDesktopProviderConnection,
} from './local-cli'

const { shell } = require('electron/common') as Pick<
  typeof import('electron'),
  'shell'
>
const { app, BrowserWindow } = require('electron/main') as Pick<
  typeof import('electron'),
  'app' | 'BrowserWindow'
>
const { ipcMain } = require('electron/main') as Pick<
  typeof import('electron'),
  'ipcMain'
>

// The desktop shell always loads the web app URL and therefore inherits
// whichever API/runtime target that web app is already configured to use.
const baseUrl = process.env.RAINCHECK_APP_URL ?? 'http://localhost:3000'

if (!app.isPackaged) {
  app.commandLine.appendSwitch('enable-logging')
}

const desktopChannels = {
  clearLocalProviderConnection: 'raincheck:clear-local-provider-connection',
  getLocalProviderConnections: 'raincheck:get-local-provider-connections',
  localCliProgress: 'raincheck:local-cli-progress',
  runLocalCliChat: 'raincheck:run-local-cli-chat',
  saveLocalProviderConnection: 'raincheck:save-local-provider-connection',
} as const

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    title: 'RainCheck',
    autoHideMenuBar: true,
    backgroundColor: '#071217',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  window.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  window.loadURL(baseUrl)
}

function registerDesktopBridge() {
  ipcMain.handle(desktopChannels.getLocalProviderConnections, async () =>
    getDesktopProviderConnections(),
  )
  ipcMain.handle(
    desktopChannels.saveLocalProviderConnection,
    async (_event, input) => saveDesktopProviderConnection(input),
  )
  ipcMain.handle(
    desktopChannels.clearLocalProviderConnection,
    async (_event, providerId) => clearDesktopProviderConnection(providerId),
  )
  ipcMain.handle(desktopChannels.runLocalCliChat, async (event, input) =>
    safeRunDesktopLocalCliChat(input, {
      emitProgress(progressEvent) {
        event.sender.send(desktopChannels.localCliProgress, progressEvent)
      },
    }),
  )
}

app.whenReady().then(() => {
  registerDesktopBridge()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
