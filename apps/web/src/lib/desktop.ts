import type {
  DesktopLocalCliChatRequest,
  DesktopLocalCliConnectionInput,
  DesktopLocalCliProgressEvent,
  DesktopLocalCliProviderId,
  DesktopLocalCliRunResult,
  DesktopProviderConnectionsResponse,
} from '@raincheck/contracts'

import { resolveApiUrl } from './api'

export type RainCheckDesktopBridge = {
  platform: 'desktop'
  getLocalProviderConnections: () => Promise<DesktopProviderConnectionsResponse>
  saveLocalProviderConnection: (
    input: DesktopLocalCliConnectionInput,
  ) => Promise<DesktopProviderConnectionsResponse>
  clearLocalProviderConnection: (
    providerId: DesktopLocalCliProviderId,
  ) => Promise<DesktopProviderConnectionsResponse>
  runLocalCliChat: (
    input: DesktopLocalCliChatRequest,
  ) => Promise<DesktopLocalCliRunResult>
  onLocalCliProgress: (
    listener: (event: DesktopLocalCliProgressEvent) => void,
  ) => () => void
}

declare global {
  interface Window {
    raincheckDesktop?: RainCheckDesktopBridge
  }
}

export function getDesktopBridge() {
  if (typeof window === 'undefined') {
    return null
  }

  return window.raincheckDesktop ?? null
}

export function isDesktopShell() {
  return getDesktopBridge()?.platform === 'desktop'
}

export function getDesktopApiBaseUrl() {
  if (typeof window === 'undefined') {
    return ''
  }

  const chatUrl = new URL(resolveApiUrl('/api/chat'), window.location.origin)
  return chatUrl.toString().replace(/\/api\/chat$/, '')
}
