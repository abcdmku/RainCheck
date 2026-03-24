import type {
  AppSettings,
  MessageRecord,
  ProviderId,
} from '@raincheck/contracts'
import { RainCheckClient } from '@raincheck/sdk'

declare const __RAINCHECK_API_BASE_URL__: string | undefined

function normalizeBaseUrl(value?: string | null) {
  return value?.replace(/\/$/, '') ?? ''
}

export function getApiBaseUrl() {
  const publicBaseUrl =
    typeof __RAINCHECK_API_BASE_URL__ === 'string'
      ? normalizeBaseUrl(__RAINCHECK_API_BASE_URL__)
      : ''

  if (typeof window !== 'undefined') {
    return publicBaseUrl
  }

  const serverBaseUrl =
    process.env.RAINCHECK_INTERNAL_API_BASE_URL ??
    (publicBaseUrl || process.env.API_BASE_URL || 'http://localhost:3001')

  return normalizeBaseUrl(serverBaseUrl)
}

export function resolveApiUrl(path: string) {
  const baseUrl = getApiBaseUrl()

  if (!path.startsWith('/')) {
    return path
  }

  return baseUrl ? `${baseUrl}${path}` : path
}

export const apiClient = new RainCheckClient({
  baseUrl: getApiBaseUrl(),
})

export type ConversationPayload = {
  conversation: {
    id: string
    title: string
    createdAt: string
    updatedAt: string
    latestPreview: string | null
  }
  messages: Array<MessageRecord>
}

export type SettingsPayload = AppSettings & {
  availableProviders?: Array<ProviderId>
}

export const queryKeys = {
  conversations: ['conversations'] as const,
  conversation: (conversationId: string) =>
    ['conversation', conversationId] as const,
  settings: ['settings'] as const,
}
