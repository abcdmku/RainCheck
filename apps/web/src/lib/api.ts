import type { MessageRecord, SettingsPayload } from '@raincheck/contracts'
import { RainCheckClient } from '@raincheck/sdk'

declare const __RAINCHECK_API_BASE_URL__: string | undefined

function normalizeBaseUrl(value?: string | null) {
  return value?.replace(/\/$/, '') ?? ''
}

export function getPublicApiBaseUrl() {
  return typeof __RAINCHECK_API_BASE_URL__ === 'string'
    ? normalizeBaseUrl(__RAINCHECK_API_BASE_URL__)
    : ''
}

export function getApiBaseUrl() {
  const publicBaseUrl = getPublicApiBaseUrl()

  if (typeof window !== 'undefined') {
    return publicBaseUrl
  }

  const serverBaseUrl =
    process.env.RAINCHECK_INTERNAL_API_BASE_URL ??
    (publicBaseUrl || process.env.API_BASE_URL || 'http://localhost:3001')

  return normalizeBaseUrl(serverBaseUrl)
}

function resolveUrl(path: string, baseUrl: string) {
  if (!path.startsWith('/')) {
    return path
  }

  return baseUrl ? `${baseUrl}${path}` : path
}

export function resolveApiUrl(path: string) {
  return resolveUrl(path, getApiBaseUrl())
}

export function resolveClientApiUrl(path: string) {
  return resolveUrl(path, getPublicApiBaseUrl())
}

export const apiClient = new RainCheckClient({
  baseUrl: getApiBaseUrl(),
})

export type { SettingsPayload }

export type ConversationPayload = {
  conversation: {
    id: string
    title: string
    pinned: boolean
    createdAt: string
    updatedAt: string
    latestPreview: string | null
  }
  messages: Array<MessageRecord>
}

export const queryKeys = {
  conversations: ['conversations'] as const,
  conversation: (conversationId: string) =>
    ['conversation', conversationId] as const,
  settings: ['settings'] as const,
}
