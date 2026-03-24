import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, shell } from 'electron'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const baseUrl = process.env.RAINCHECK_APP_URL ?? 'http://localhost:3000'

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

app.whenReady().then(() => {
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
