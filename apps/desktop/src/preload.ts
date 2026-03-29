const { contextBridge, ipcRenderer } = require('electron/renderer') as Pick<
  typeof import('electron'),
  'contextBridge' | 'ipcRenderer'
>

const desktopChannels = {
  clearLocalProviderConnection: 'raincheck:clear-local-provider-connection',
  getLocalProviderConnections: 'raincheck:get-local-provider-connections',
  localCliProgress: 'raincheck:local-cli-progress',
  runLocalCliChat: 'raincheck:run-local-cli-chat',
  saveLocalProviderConnection: 'raincheck:save-local-provider-connection',
} as const

contextBridge.exposeInMainWorld('raincheckDesktop', {
  platform: 'desktop',
  getLocalProviderConnections() {
    return ipcRenderer.invoke(desktopChannels.getLocalProviderConnections)
  },
  saveLocalProviderConnection(input: unknown) {
    return ipcRenderer.invoke(
      desktopChannels.saveLocalProviderConnection,
      input,
    )
  },
  clearLocalProviderConnection(providerId: string) {
    return ipcRenderer.invoke(
      desktopChannels.clearLocalProviderConnection,
      providerId,
    )
  },
  runLocalCliChat(input: unknown) {
    return ipcRenderer.invoke(desktopChannels.runLocalCliChat, input)
  },
  onLocalCliProgress(listener: (event: unknown) => void) {
    const wrappedListener = (_event: unknown, payload: unknown) => {
      listener(payload)
    }

    ipcRenderer.on(desktopChannels.localCliProgress, wrappedListener)

    return () => {
      ipcRenderer.off(desktopChannels.localCliProgress, wrappedListener)
    }
  },
})
