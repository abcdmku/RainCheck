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
  const injectedBaseUrl =
    typeof __RAINCHECK_API_BASE_URL__ === 'string'
      ? normalizeBaseUrl(__RAINCHECK_API_BASE_URL__)
      : ''

  if (injectedBaseUrl) {
    return injectedBaseUrl
  }

  if (typeof window !== 'undefined') {
    return ''
  }

  return normalizeBaseUrl(process.env.API_BASE_URL ?? 'http://localhost:3001')
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
