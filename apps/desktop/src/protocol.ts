export type DesktopLocalCliProviderId = 'openai' | 'anthropic'

export type LocalCliDiagnostics = {
  command: 'codex' | 'claude'
  detected: boolean
  authReady: boolean
  authMethod: string | null
  subscriptionType: string | null
  statusLabel: string
}

export type DesktopLocalCliConnectionInput = {
  providerId: DesktopLocalCliProviderId
  model: string
}

export type DesktopLocalCliConnectionState = {
  providerId: DesktopLocalCliProviderId
  connected: boolean
  configured: boolean
  model: string | null
  updatedAt: string | null
  localCli: LocalCliDiagnostics
}

export type DesktopProviderConnectionsResponse = {
  providers: Array<DesktopLocalCliConnectionState>
}

export type DesktopLocationOverride = {
  label: string
  name?: string
  latitude?: number
  longitude?: number
  region?: string
  country?: string
  timezone?: string
  source?: 'saved' | 'device' | 'message' | 'manual'
}

export type WeatherAnswerContextSnapshot = {
  location: DesktopLocationOverride | null
  units: 'imperial' | 'metric'
  timeDisplay: 'user-local' | 'dual' | 'target-local'
  answerTone: 'casual' | 'professional'
  displayTimezone?: string
}

export type MessageRecord = {
  id: string
  conversationId: string
  role: 'user' | 'assistant' | 'system'
  content: string
  parts: Array<Record<string, unknown>>
  citations: Array<Record<string, unknown>>
  artifacts: Array<Record<string, unknown>>
  createdAt: string
  model: string | null
  provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter' | null
  transport: 'api' | 'local-cli' | null
  source: 'shared-env' | 'local-api-key' | 'desktop-local-cli' | null
}

export type DesktopLocalCliToolCatalogItem = {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type DesktopLocalCliToolCall = {
  name: string
  arguments: Record<string, unknown>
}

export type DesktopLocalCliToolResult = {
  name: string
  arguments: Record<string, unknown>
  result: unknown
}

export type DesktopLocalCliProgressEvent = {
  type: 'status' | 'tool-call' | 'tool-result'
  label: string
  toolCall?: DesktopLocalCliToolCall
  toolResult?: DesktopLocalCliToolResult
}

export type DesktopLocalCliPreparedSession = {
  conversationId: string
  userMessageId: string
  providerId: DesktopLocalCliProviderId
  model: string
  route: {
    provider: DesktopLocalCliProviderId
    model: string
    transport: 'local-cli'
    source: 'desktop-local-cli'
  }
  classification: Record<string, unknown>
  systemPrompt: string
  messages: Array<MessageRecord>
  toolCatalog: Array<DesktopLocalCliToolCatalogItem>
  answerContext: WeatherAnswerContextSnapshot
}

export type DesktopLocalCliPrepareResponse = {
  session: DesktopLocalCliPreparedSession
}

export type DesktopLocalCliExecuteToolsResponse = {
  progressEvents: Array<DesktopLocalCliProgressEvent>
  results: Array<DesktopLocalCliToolResult>
}

export type DesktopLocalCliRunResult = {
  message: MessageRecord
  citations: Array<Record<string, unknown>>
  artifacts: Array<Record<string, unknown>>
}

export type DesktopLocalCliChatRequest = {
  apiBaseUrl: string
  conversationId: string
  message: string
  clientMessageId?: string
  providerId: DesktopLocalCliProviderId
  model: string
  route: {
    transport: 'local-cli'
    source: 'desktop-local-cli'
  }
  context: WeatherAnswerContextSnapshot
}
