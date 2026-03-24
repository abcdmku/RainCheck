import { contextBridge } from 'electron'

contextBridge.exposeInMainWorld('raincheckDesktop', {
  platform: 'desktop',
})
