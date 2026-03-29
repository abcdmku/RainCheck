import { execFile, spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  DesktopLocalCliChatRequest,
  DesktopLocalCliProgressEvent,
  DesktopLocalCliProviderId,
  DesktopLocalCliRunResult,
  DesktopLocalCliToolCall,
  DesktopLocalCliToolCatalogItem,
  DesktopLocalCliToolResult,
  DesktopProviderConnectionsResponse,
  LocalCliDiagnostics,
  MessageRecord,
} from './protocol'

type ToolCallPlan = {
  toolCalls: Array<DesktopLocalCliToolCall>
}

type ResolvedCliInvocation = {
  file: string
  argsPrefix: Array<string>
}

const localCliTimeoutMs = 90_000
const promptResultCharLimit = 8_000
const powershellCommandWrapper =
  '& { $command = $args[0]; if ($args.Length -gt 1) { & $command @($args[1..($args.Length - 1)]) } else { & $command } }'
const followUpToolNames = new Set([
  'synthesize_weather_conclusion',
  'compare_weather_candidates',
  'generate_weather_artifact',
])
const toolPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: {
            type: 'string',
          },
          arguments: {
            type: 'object',
            additionalProperties: true,
          },
        },
        required: ['name', 'arguments'],
      },
      default: [],
    },
  },
  required: ['toolCalls'],
} as const

function asRecord(value: unknown, message: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message)
  }

  return value as Record<string, unknown>
}

function asString(value: unknown, message: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(message)
  }

  return value
}

function asOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asArray(value: unknown, message: string) {
  if (!Array.isArray(value)) {
    throw new Error(message)
  }

  return value
}

function isProviderId(value: unknown): value is DesktopLocalCliProviderId {
  return value === 'openai' || value === 'anthropic'
}

function isProgressEventType(
  value: unknown,
): value is DesktopLocalCliProgressEvent['type'] {
  return value === 'status' || value === 'tool-call' || value === 'tool-result'
}

function parseLocalCliDiagnostics(value: unknown): LocalCliDiagnostics {
  const record = asRecord(value, 'Invalid local CLI diagnostics payload.')
  const command =
    record.command === 'codex' || record.command === 'claude'
      ? record.command
      : 'codex'

  return {
    command,
    detected: Boolean(record.detected),
    authReady: Boolean(record.authReady),
    authMethod:
      typeof record.authMethod === 'string' ? record.authMethod : null,
    subscriptionType:
      typeof record.subscriptionType === 'string'
        ? record.subscriptionType
        : null,
    statusLabel:
      typeof record.statusLabel === 'string'
        ? record.statusLabel
        : 'Unknown local CLI status',
  }
}

function parseMessageRecord(value: unknown): MessageRecord {
  const record = asRecord(value, 'Invalid message record payload.')

  return {
    id: asString(record.id, 'Message id is missing.'),
    conversationId: asString(
      record.conversationId,
      'Message conversation id is missing.',
    ),
    role:
      record.role === 'user' ||
      record.role === 'assistant' ||
      record.role === 'system'
        ? record.role
        : 'assistant',
    content: typeof record.content === 'string' ? record.content : '',
    parts: Array.isArray(record.parts)
      ? record.parts.filter((part): part is Record<string, unknown> =>
          Boolean(part && typeof part === 'object' && !Array.isArray(part)),
        )
      : [],
    citations: Array.isArray(record.citations)
      ? record.citations.filter((entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)),
        )
      : [],
    artifacts: Array.isArray(record.artifacts)
      ? record.artifacts.filter((entry): entry is Record<string, unknown> =>
          Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)),
        )
      : [],
    createdAt: asString(record.createdAt, 'Message createdAt is missing.'),
    model: typeof record.model === 'string' ? record.model : null,
    provider:
      record.provider === 'openai' ||
      record.provider === 'anthropic' ||
      record.provider === 'gemini' ||
      record.provider === 'openrouter'
        ? record.provider
        : null,
    transport:
      record.transport === 'api' || record.transport === 'local-cli'
        ? record.transport
        : null,
    source:
      record.source === 'shared-env' ||
      record.source === 'local-api-key' ||
      record.source === 'desktop-local-cli'
        ? record.source
        : null,
  }
}

function parseToolCatalogItem(value: unknown): DesktopLocalCliToolCatalogItem {
  const record = asRecord(value, 'Invalid desktop tool catalog item.')

  return {
    name: asString(record.name, 'Tool name is missing.'),
    description:
      typeof record.description === 'string' ? record.description : '',
    inputSchema:
      record.inputSchema &&
      typeof record.inputSchema === 'object' &&
      !Array.isArray(record.inputSchema)
        ? (record.inputSchema as Record<string, unknown>)
        : {},
  }
}

function parseToolResult(value: unknown): DesktopLocalCliToolResult {
  const record = asRecord(value, 'Invalid tool result payload.')

  return {
    name: asString(record.name, 'Tool result name is missing.'),
    arguments:
      record.arguments &&
      typeof record.arguments === 'object' &&
      !Array.isArray(record.arguments)
        ? (record.arguments as Record<string, unknown>)
        : {},
    result: record.result,
  }
}

function parseProgressEvent(value: unknown): DesktopLocalCliProgressEvent {
  const record = asRecord(value, 'Invalid progress event payload.')
  const type = isProgressEventType(record.type) ? record.type : 'status'

  return {
    type,
    label: typeof record.label === 'string' ? record.label : 'Working',
    ...(record.toolCall &&
    typeof record.toolCall === 'object' &&
    !Array.isArray(record.toolCall)
      ? {
          toolCall: {
            name: asString(
              (record.toolCall as Record<string, unknown>).name,
              'Tool call name is missing.',
            ),
            arguments:
              (record.toolCall as Record<string, unknown>).arguments &&
              typeof (record.toolCall as Record<string, unknown>).arguments ===
                'object' &&
              !Array.isArray(
                (record.toolCall as Record<string, unknown>).arguments,
              )
                ? ((record.toolCall as Record<string, unknown>)
                    .arguments as Record<string, unknown>)
                : {},
          },
        }
      : {}),
    ...(record.toolResult &&
    typeof record.toolResult === 'object' &&
    !Array.isArray(record.toolResult)
      ? {
          toolResult: parseToolResult(record.toolResult),
        }
      : {}),
  }
}

function parseChatRequest(value: unknown): DesktopLocalCliChatRequest {
  const record = asRecord(value, 'Invalid local CLI request payload.')
  const providerId = isProviderId(record.providerId)
    ? record.providerId
    : (() => {
        throw new Error('Provider id is invalid.')
      })()
  const route = asRecord(record.route, 'Local CLI route metadata is missing.')
  const context = asRecord(
    record.context,
    'Local CLI answer context is missing.',
  )

  return {
    apiBaseUrl: asString(record.apiBaseUrl, 'API base URL is required.'),
    conversationId: asString(
      record.conversationId,
      'Conversation id is required.',
    ),
    message: asString(record.message, 'Message text is required.'),
    clientMessageId: asOptionalString(record.clientMessageId),
    providerId,
    model: asString(record.model, 'Model is required.'),
    route: {
      transport: route.transport === 'local-cli' ? 'local-cli' : 'local-cli',
      source:
        route.source === 'desktop-local-cli'
          ? 'desktop-local-cli'
          : 'desktop-local-cli',
    },
    context: {
      location:
        context.location &&
        typeof context.location === 'object' &&
        !Array.isArray(context.location)
          ? {
              label: asString(
                (context.location as Record<string, unknown>).label,
                'Location label is required.',
              ),
              name: asOptionalString(
                (context.location as Record<string, unknown>).name,
              ),
              latitude:
                typeof (context.location as Record<string, unknown>)
                  .latitude === 'number' &&
                Number.isFinite(
                  (context.location as Record<string, unknown>).latitude,
                )
                  ? Number(
                      (context.location as Record<string, unknown>).latitude,
                    )
                  : undefined,
              longitude:
                typeof (context.location as Record<string, unknown>)
                  .longitude === 'number' &&
                Number.isFinite(
                  (context.location as Record<string, unknown>).longitude,
                )
                  ? Number(
                      (context.location as Record<string, unknown>).longitude,
                    )
                  : undefined,
              region: asOptionalString(
                (context.location as Record<string, unknown>).region,
              ),
              country: asOptionalString(
                (context.location as Record<string, unknown>).country,
              ),
              timezone: asOptionalString(
                (context.location as Record<string, unknown>).timezone,
              ),
              source:
                (context.location as Record<string, unknown>).source ===
                  'saved' ||
                (context.location as Record<string, unknown>).source ===
                  'device' ||
                (context.location as Record<string, unknown>).source ===
                  'message' ||
                (context.location as Record<string, unknown>).source ===
                  'manual'
                  ? ((context.location as Record<string, unknown>).source as
                      | 'saved'
                      | 'device'
                      | 'message'
                      | 'manual')
                  : undefined,
            }
          : null,
      units: context.units === 'metric' ? 'metric' : 'imperial',
      timeDisplay:
        context.timeDisplay === 'dual' || context.timeDisplay === 'target-local'
          ? context.timeDisplay
          : 'user-local',
      answerTone:
        context.answerTone === 'professional' ? 'professional' : 'casual',
      displayTimezone: asOptionalString(context.displayTimezone),
    },
  }
}

function parsePrepareResponse(value: unknown) {
  const record = asRecord(value, 'Invalid prepare response payload.')
  const sessionRecord = asRecord(record.session, 'Prepared session is missing.')
  const routeRecord = asRecord(
    sessionRecord.route,
    'Prepared route is missing.',
  )

  return {
    session: {
      conversationId: asString(
        sessionRecord.conversationId,
        'Prepared conversation id is missing.',
      ),
      userMessageId: asString(
        sessionRecord.userMessageId,
        'Prepared user message id is missing.',
      ),
      providerId: isProviderId(sessionRecord.providerId)
        ? sessionRecord.providerId
        : (() => {
            throw new Error('Prepared provider id is invalid.')
          })(),
      model: asString(sessionRecord.model, 'Prepared model is missing.'),
      route: {
        provider: isProviderId(routeRecord.provider)
          ? routeRecord.provider
          : (() => {
              throw new Error('Prepared route provider is invalid.')
            })(),
        model: asString(routeRecord.model, 'Prepared route model is missing.'),
        transport: 'local-cli' as const,
        source: 'desktop-local-cli' as const,
      },
      classification:
        sessionRecord.classification &&
        typeof sessionRecord.classification === 'object' &&
        !Array.isArray(sessionRecord.classification)
          ? (sessionRecord.classification as Record<string, unknown>)
          : {},
      systemPrompt: asString(
        sessionRecord.systemPrompt,
        'Prepared system prompt is missing.',
      ),
      messages: asArray(
        sessionRecord.messages,
        'Prepared messages are missing.',
      ).map(parseMessageRecord),
      toolCatalog: asArray(
        sessionRecord.toolCatalog,
        'Prepared tool catalog is missing.',
      ).map(parseToolCatalogItem),
      answerContext: parseChatRequest({
        apiBaseUrl: 'https://example.com',
        conversationId: 'placeholder',
        message: 'placeholder',
        providerId: 'openai',
        model: 'placeholder',
        route: {
          transport: 'local-cli',
          source: 'desktop-local-cli',
        },
        context: sessionRecord.answerContext,
      }).context,
    },
  }
}

function parseExecuteToolsResponse(value: unknown) {
  const record = asRecord(value, 'Invalid execute-tools response payload.')

  return {
    progressEvents: asArray(
      record.progressEvents ?? [],
      'Progress events must be an array.',
    ).map(parseProgressEvent),
    results: asArray(record.results, 'Tool results are missing.').map(
      parseToolResult,
    ),
  }
}

function parseRunResult(value: unknown): DesktopLocalCliRunResult {
  const record = asRecord(value, 'Invalid local CLI completion payload.')

  return {
    message: parseMessageRecord(record.message),
    citations: asArray(
      record.citations ?? [],
      'Citations must be an array.',
    ).filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)),
    ),
    artifacts: asArray(
      record.artifacts ?? [],
      'Artifacts must be an array.',
    ).filter((entry): entry is Record<string, unknown> =>
      Boolean(entry && typeof entry === 'object' && !Array.isArray(entry)),
    ),
  }
}

function parseDesktopProviderConnectionsResponse(
  value: unknown,
): DesktopProviderConnectionsResponse {
  const record = asRecord(value, 'Invalid desktop provider response.')

  return {
    providers: asArray(record.providers, 'Desktop providers are missing.').map(
      (entry) => {
        const provider = asRecord(entry, 'Invalid desktop provider state.')
        const providerId = isProviderId(provider.providerId)
          ? provider.providerId
          : (() => {
              throw new Error('Desktop provider id is invalid.')
            })()

        return {
          providerId,
          connected: Boolean(provider.connected),
          configured: Boolean(provider.configured),
          model: typeof provider.model === 'string' ? provider.model : null,
          updatedAt:
            typeof provider.updatedAt === 'string' ? provider.updatedAt : null,
          localCli: parseLocalCliDiagnostics(provider.localCli),
        }
      },
    ),
  }
}

function providerCommand(providerId: DesktopLocalCliProviderId) {
  switch (providerId) {
    case 'openai':
      return 'codex'
    case 'anthropic':
      return 'claude'
  }
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, '')
}

function readErrorMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  return 'Local CLI request failed.'
}

function stringifyPromptValue(
  value: unknown,
  maxChars = promptResultCharLimit,
) {
  let serialized = ''
  try {
    serialized =
      typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '')
  } catch {
    serialized = String(value)
  }

  if (serialized.length <= maxChars) {
    return serialized
  }

  return `${serialized.slice(0, maxChars).trimEnd()}\n...`
}

function extractMessageText(message: {
  content?: string
  parts?: Array<{ type?: string; content?: string }>
}) {
  if (typeof message.content === 'string' && message.content.trim()) {
    return message.content
  }

  if (!Array.isArray(message.parts)) {
    return ''
  }

  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.content ?? '')
    .join('')
}

function formatConversation(
  messages: Array<{
    role: string
    content?: string
    parts?: Array<{ type?: string; content?: string }>
  }>,
) {
  return messages
    .map((message) => {
      const text = extractMessageText(message).trim()
      if (!text) {
        return null
      }

      return `${message.role.toUpperCase()}: ${text}`
    })
    .filter(Boolean)
    .join('\n')
}

function formatToolCatalog(tools: Array<DesktopLocalCliToolCatalogItem>) {
  return tools
    .map((tool) =>
      [
        `- ${tool.name}: ${tool.description}`,
        `  Input schema: ${stringifyPromptValue(tool.inputSchema, 1_000)}`,
      ].join('\n'),
    )
    .join('\n')
}

function formatToolResults(results: Array<DesktopLocalCliToolResult>) {
  return results
    .map((result, index) =>
      [
        `Tool ${index + 1}: ${result.name}`,
        `Input: ${stringifyPromptValue(result.arguments, 2_000)}`,
        `Output: ${stringifyPromptValue(result.result)}`,
      ].join('\n'),
    )
    .join('\n\n')
}

function splitToolCatalog(tools: Array<DesktopLocalCliToolCatalogItem>) {
  const dataTools: Array<DesktopLocalCliToolCatalogItem> = []
  const followUpTools: Array<DesktopLocalCliToolCatalogItem> = []

  for (const tool of tools) {
    if (followUpToolNames.has(tool.name)) {
      followUpTools.push(tool)
      continue
    }

    dataTools.push(tool)
  }

  return {
    dataTools,
    followUpTools,
  }
}

function buildPlannerPrompt(input: {
  phase: 'data' | 'follow-up'
  systemPrompt: string
  classification: unknown
  messages: Array<{
    role: string
    content?: string
    parts?: Array<{ type?: string; content?: string }>
  }>
  tools: Array<DesktopLocalCliToolCatalogItem>
  priorResults?: Array<DesktopLocalCliToolResult>
}) {
  return [
    'You are planning RainCheck server weather tool calls.',
    'Return JSON only that matches the provided schema.',
    'Do not answer the user directly.',
    'Use only the allowed tool names.',
    input.phase === 'data'
      ? 'Choose the smallest useful set of data-gathering tools for this turn.'
      : 'Choose only conclusion, comparison, or artifact tools after reviewing the trusted RainCheck results.',
    'If the user asks about SPC outlooks, convective outlooks, or Day 1/2/3/4-8 severe products, prefer get_severe_context first.',
    'For severe-weather questions beyond the next two days, prefer derive_global_weather over storm-scale nowcast tools when it is available.',
    '',
    'RainCheck system guidance:',
    input.systemPrompt,
    '',
    'Conversation:',
    formatConversation(input.messages),
    '',
    'Classification:',
    stringifyPromptValue(input.classification, 2_000),
    '',
    'Allowed tools:',
    formatToolCatalog(input.tools),
    ...(input.priorResults?.length
      ? [
          '',
          'Trusted RainCheck tool results already collected for this turn:',
          formatToolResults(input.priorResults),
        ]
      : []),
  ].join('\n')
}

function buildFinalAnswerPrompt(input: {
  systemPrompt: string
  classification: unknown
  messages: Array<{
    role: string
    content?: string
    parts?: Array<{ type?: string; content?: string }>
  }>
  toolResults: Array<DesktopLocalCliToolResult>
}) {
  return [
    'Write the final RainCheck assistant reply for the user.',
    'Use only the trusted RainCheck tool results below and do not invent missing weather data.',
    'Do not mention tools, JSON, planning, CLI internals, or server orchestration.',
    'If trusted RainCheck tool results are present, never say the data came back empty, nothing usable returned, or that you could not pull it up. Summarize the trusted results directly instead.',
    'Do not ask the user to send forecast details, weather results, or source text when trusted RainCheck tool results are already present.',
    '',
    'RainCheck system guidance:',
    input.systemPrompt,
    '',
    'Conversation:',
    formatConversation(input.messages),
    '',
    'Classification:',
    stringifyPromptValue(input.classification, 2_000),
    '',
    'Trusted RainCheck tool results:',
    formatToolResults(input.toolResults),
  ].join('\n')
}

function sanitizeJsonText(value: string) {
  const trimmed = value.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)

  if (fenced) {
    return fenced[1].trim()
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return trimmed
}

function parseToolPlan(value: string): ToolCallPlan {
  const sanitized = sanitizeJsonText(value)

  if (!sanitized) {
    return {
      toolCalls: [],
    }
  }

  const parsed = JSON.parse(sanitized) as Partial<ToolCallPlan>

  return {
    toolCalls: Array.isArray(parsed.toolCalls)
      ? parsed.toolCalls.map((entry) => ({
          name: String(entry?.name ?? '').trim(),
          arguments:
            entry?.arguments && typeof entry.arguments === 'object'
              ? (entry.arguments as Record<string, unknown>)
              : {},
        }))
      : [],
  }
}

function readClassificationIntent(classification: unknown) {
  if (
    !classification ||
    typeof classification !== 'object' ||
    Array.isArray(classification)
  ) {
    return ''
  }

  return typeof (classification as Record<string, unknown>).intent === 'string'
    ? String((classification as Record<string, unknown>).intent)
    : ''
}

function readClassificationTimeHorizonHours(classification: unknown) {
  if (
    !classification ||
    typeof classification !== 'object' ||
    Array.isArray(classification)
  ) {
    return 0
  }

  const timeHorizonHours = (classification as Record<string, unknown>)
    .timeHorizonHours
  return typeof timeHorizonHours === 'number' &&
    Number.isFinite(timeHorizonHours)
    ? Math.max(0, Math.min(720, Math.round(timeHorizonHours)))
    : 0
}

function buildDeterministicDataPlan(input: {
  classification: unknown
  tools: Array<DesktopLocalCliToolCatalogItem>
  defaultLocationQuery?: string | null
}): ToolCallPlan {
  const availableToolNames = new Set(input.tools.map((tool) => tool.name))
  const toolCalls: Array<DesktopLocalCliToolCall> = []
  const intent = readClassificationIntent(input.classification)
  const timeHorizonHours = readClassificationTimeHorizonHours(
    input.classification,
  )
  const locationQuery = input.defaultLocationQuery?.trim() || undefined

  const pushToolCall = (
    name: string,
    argumentsValue: Record<string, unknown>,
  ) => {
    if (
      !availableToolNames.has(name) ||
      toolCalls.some((toolCall) => toolCall.name === name)
    ) {
      return
    }

    toolCalls.push({
      name,
      arguments: argumentsValue,
    })
  }

  switch (intent) {
    case 'severe-weather':
      pushToolCall('get_severe_context', {
        ...(locationQuery ? { locationQuery } : {}),
        ...(timeHorizonHours > 0 ? { timeHorizonHours } : {}),
      })

      if (locationQuery) {
        pushToolCall('get_forecast', {
          locationQuery,
          horizon: timeHorizonHours >= 48 ? 'extended' : 'short',
        })

        if (timeHorizonHours <= 24) {
          pushToolCall('get_alerts', {
            locationQuery,
          })
        }
      }
      break
    default:
      if (locationQuery) {
        pushToolCall('get_forecast', {
          locationQuery,
          horizon: timeHorizonHours >= 48 ? 'extended' : 'short',
        })
        pushToolCall('get_alerts', {
          locationQuery,
        })

        if (timeHorizonHours <= 24) {
          pushToolCall('get_current_conditions', {
            locationQuery,
          })
        }
      }
      break
  }

  return {
    toolCalls,
  }
}

function buildFallbackAnswer(toolResults: Array<DesktopLocalCliToolResult>) {
  for (const result of [...toolResults].reverse()) {
    if (!result.result || typeof result.result !== 'object') {
      continue
    }

    if (
      typeof (result.result as { bottomLine?: unknown }).bottomLine === 'string'
    ) {
      return String((result.result as { bottomLine: string }).bottomLine)
    }

    if (typeof (result.result as { summary?: unknown }).summary === 'string') {
      return String((result.result as { summary: string }).summary)
    }

    if (
      typeof (result.result as { mostLikelyScenario?: unknown })
        .mostLikelyScenario === 'string'
    ) {
      return String(
        (result.result as { mostLikelyScenario: string }).mostLikelyScenario,
      )
    }

    if (
      typeof (result.result as { agreementSummary?: unknown })
        .agreementSummary === 'string'
    ) {
      return String(
        (result.result as { agreementSummary: string }).agreementSummary,
      )
    }
  }

  return 'RainCheck could not finish a local CLI response for this turn.'
}

function looksLikeMissingDataAnswer(text: string) {
  const normalized = text.trim()
  if (!normalized) {
    return false
  }

  return [
    /\bwasn't able to pull up\b/i,
    /\bcouldn't pull up\b/i,
    /\bcould not pull up\b/i,
    /\bcame back empty\b/i,
    /\bno [a-z- ]*data came back\b/i,
    /\bdidn't come back with anything usable\b/i,
    /\bnothing usable\b/i,
    /\bunable to fetch\b/i,
    /\bfetch came back empty\b/i,
    /\b(?:i do not|i don't) have (?:the )?(?:forecast|weather) details\b/i,
    /\b(?:can(?:not|'t)) tell you\b[^.?!]*\bwithout guessing\b/i,
    /\bif you send (?:the )?(?:forecast|weather) (?:summary|results)\b/i,
  ].some((pattern) => pattern.test(normalized))
}

function missingCommandDiagnostics(
  providerId: DesktopLocalCliProviderId,
): LocalCliDiagnostics {
  return {
    command: providerCommand(providerId),
    detected: false,
    authReady: false,
    authMethod: null,
    subscriptionType: null,
    statusLabel:
      providerId === 'openai'
        ? 'Codex CLI not found on PATH'
        : 'Claude Code not found on PATH',
  }
}

function notReadyDiagnostics(
  providerId: DesktopLocalCliProviderId,
  statusLabel: string,
  authMethod: string | null = null,
  subscriptionType: string | null = null,
) {
  return {
    command: providerCommand(providerId),
    detected: true,
    authReady: false,
    authMethod,
    subscriptionType,
    statusLabel,
  }
}

function readyDiagnostics(input: {
  providerId: DesktopLocalCliProviderId
  authMethod: string | null
  statusLabel: string
  subscriptionType?: string | null
}) {
  return {
    command: providerCommand(input.providerId),
    detected: true,
    authReady: true,
    authMethod: input.authMethod,
    subscriptionType: input.subscriptionType ?? null,
    statusLabel: input.statusLabel,
  }
}

async function fileExists(filePath: string) {
  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolveWindowsCommandSource(command: 'codex' | 'claude') {
  try {
    const { stdout } = await execFileCapture('where.exe', [command], {
      timeout: 5_000,
    })
    const candidates = stdout
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .filter(Boolean)
    const preferred =
      candidates.find((entry) => entry.toLowerCase().endsWith('.exe')) ??
      candidates.find((entry) => entry.toLowerCase().endsWith('.cmd')) ??
      candidates.find((entry) => entry.toLowerCase().endsWith('.bat')) ??
      candidates.find((entry) => !path.extname(entry)) ??
      candidates.find((entry) => entry.toLowerCase().endsWith('.ps1')) ??
      candidates[0]

    if (preferred) {
      return preferred
    }
  } catch {
    // Fall through to PowerShell command discovery for shells that do not
    // expose the same PATH entries through `where.exe`.
  }

  try {
    const { stdout } = await execFileCapture(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Command -Name '${command}' -ErrorAction Stop | Select-Object -First 1 -ExpandProperty Source)`,
      ],
      {
        timeout: 5_000,
      },
    )
    return stdout.trim() || null
  } catch {
    return null
  }
}

async function resolveCliInvocation(
  command: 'codex' | 'claude',
): Promise<ResolvedCliInvocation> {
  if (process.platform !== 'win32') {
    return {
      file: command,
      argsPrefix: [],
    }
  }

  const source = await resolveWindowsCommandSource(command)
  if (!source) {
    return {
      file: command,
      argsPrefix: [],
    }
  }

  const extension = path.extname(source).toLowerCase()
  if (!extension) {
    const cmdPath = `${source}.cmd`
    if (await fileExists(cmdPath)) {
      return {
        file: 'powershell.exe',
        argsPrefix: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          powershellCommandWrapper,
          cmdPath,
        ],
      }
    }
  }

  if (extension === '.cmd' || extension === '.bat') {
    return {
      file: 'powershell.exe',
      argsPrefix: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        powershellCommandWrapper,
        source,
      ],
    }
  }

  if (source.toLowerCase().endsWith('.ps1')) {
    const cmdPath = source.replace(/\.ps1$/i, '.cmd')
    if (await fileExists(cmdPath)) {
      return {
        file: 'powershell.exe',
        argsPrefix: [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          powershellCommandWrapper,
          cmdPath,
        ],
      }
    }

    return {
      file: 'powershell.exe',
      argsPrefix: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', source],
    }
  }

  return {
    file: source,
    argsPrefix: [],
  }
}

function execFileCapture(
  file: string,
  args: Array<string>,
  options: {
    timeout?: number
    maxBuffer?: number
  } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(
          Object.assign(error, {
            stdout,
            stderr,
          }),
        )
        return
      }

      resolve({
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      })
    })
  })
}

function spawnCapture(input: {
  file: string
  args: Array<string>
  stdinText?: string
  timeout?: number
  maxBuffer?: number
  label: string
}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(input.file, input.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const maxBuffer = input.maxBuffer ?? Number.POSITIVE_INFINITY
    let stdout = ''
    let stderr = ''
    let settled = false

    const finishReject = (error: Error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      reject(
        Object.assign(error, {
          stdout,
          stderr,
        }),
      )
    }

    const finishResolve = () => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
      })
    }

    const appendOutput = (
      key: 'stdout' | 'stderr',
      chunk: string | Buffer<ArrayBufferLike>,
    ) => {
      const nextValue = `${key === 'stdout' ? stdout : stderr}${String(chunk)}`

      if (Buffer.byteLength(nextValue, 'utf8') > maxBuffer) {
        child.kill()
        finishReject(new Error(`${input.label} output exceeded maxBuffer`))
        return
      }

      if (key === 'stdout') {
        stdout = nextValue
        return
      }

      stderr = nextValue
    }

    const timer = setTimeout(() => {
      child.kill()
      finishReject(new Error(`${input.label} timed out`))
    }, input.timeout ?? localCliTimeoutMs)

    child.stdout.on('data', (chunk) => {
      appendOutput('stdout', chunk)
    })
    child.stderr.on('data', (chunk) => {
      appendOutput('stderr', chunk)
    })
    child.stdin.on('error', (error) => {
      const errorCode = (error as NodeJS.ErrnoException).code
      if (settled || errorCode === 'EPIPE') {
        return
      }

      finishReject(error)
    })
    child.on('error', (error) => {
      finishReject(error)
    })
    child.on('close', (code) => {
      if (code === 0) {
        finishResolve()
        return
      }

      finishReject(
        new Error(
          stderr.trim() ||
            `${input.label} exited with code ${String(code ?? 'unknown')}`,
        ),
      )
    })

    child.stdin.end(input.stdinText ?? '')
  })
}

async function execCliCapture(
  command: 'codex' | 'claude',
  args: Array<string>,
  options: {
    timeout?: number
    maxBuffer?: number
  } = {},
) {
  const invocation = await resolveCliInvocation(command)

  return execFileCapture(
    invocation.file,
    [...invocation.argsPrefix, ...args],
    options,
  )
}

async function spawnCliCapture(
  command: 'codex' | 'claude',
  args: Array<string>,
  options: {
    timeout?: number
    maxBuffer?: number
    stdinText?: string
  } = {},
) {
  const invocation = await resolveCliInvocation(command)

  return spawnCapture({
    file: invocation.file,
    args: [...invocation.argsPrefix, ...args],
    stdinText: options.stdinText,
    timeout: options.timeout,
    maxBuffer: options.maxBuffer,
    label: command === 'claude' ? 'Claude CLI' : 'Codex CLI',
  })
}

async function readCodexDiagnostics() {
  try {
    const { stdout, stderr } = await execCliCapture(
      'codex',
      ['login', 'status'],
      {
        timeout: 5_000,
      },
    )
    const output = [stdout, stderr].join('\n').trim()
    const match = output.match(/^Logged in using (.+)$/i)

    if (match) {
      return readyDiagnostics({
        providerId: 'openai',
        authMethod: match[1].trim(),
        statusLabel: `Ready via ${match[1].trim()}`,
      })
    }

    if (output) {
      return readyDiagnostics({
        providerId: 'openai',
        authMethod: null,
        statusLabel: output,
      })
    }

    return notReadyDiagnostics('openai', 'Codex CLI login status unavailable')
  } catch (error: any) {
    const message = String(
      error?.stderr ?? error?.stdout ?? error?.message ?? '',
    )
    if (error?.code === 'ENOENT') {
      return missingCommandDiagnostics('openai')
    }

    return notReadyDiagnostics(
      'openai',
      message.trim() || 'Codex CLI is installed but not logged in',
    )
  }
}

async function readClaudeDiagnostics() {
  try {
    const { stdout } = await execCliCapture('claude', ['auth', 'status'], {
      timeout: 5_000,
    })
    const output = stdout.trim()
    if (!output) {
      return notReadyDiagnostics(
        'anthropic',
        'Claude Code auth status unavailable',
      )
    }

    const parsed = JSON.parse(output) as {
      loggedIn?: boolean
      authMethod?: string
      subscriptionType?: string
    }

    if (parsed.loggedIn) {
      const authMethod = parsed.authMethod ?? null
      const subscriptionType = parsed.subscriptionType ?? null
      const statusSuffix = subscriptionType
        ? `${authMethod ?? 'authenticated'} (${subscriptionType})`
        : (authMethod ?? 'authenticated')

      return readyDiagnostics({
        providerId: 'anthropic',
        authMethod,
        subscriptionType,
        statusLabel: `Ready via ${statusSuffix}`,
      })
    }

    return notReadyDiagnostics(
      'anthropic',
      'Claude Code is installed but not logged in',
      parsed.authMethod ?? null,
      parsed.subscriptionType ?? null,
    )
  } catch (error: any) {
    const message = String(
      error?.stderr ?? error?.stdout ?? error?.message ?? '',
    )
    if (error?.code === 'ENOENT') {
      return missingCommandDiagnostics('anthropic')
    }

    return notReadyDiagnostics(
      'anthropic',
      message.trim() || 'Claude Code is installed but not logged in',
    )
  }
}

export async function getLocalCliDiagnostics(
  providerId: DesktopLocalCliProviderId,
) {
  switch (providerId) {
    case 'openai':
      return readCodexDiagnostics()
    case 'anthropic':
      return readClaudeDiagnostics()
  }
}

export async function getDesktopProviderConnections(): Promise<DesktopProviderConnectionsResponse> {
  const providers = await Promise.all(
    (['openai', 'anthropic'] as const).map(async (providerId) => {
      const localCli = await getLocalCliDiagnostics(providerId)

      return {
        providerId,
        connected: localCli.authReady,
        configured: localCli.authReady,
        model: null,
        updatedAt: null,
        localCli,
      }
    }),
  )

  return parseDesktopProviderConnectionsResponse({
    providers,
  })
}

export async function saveDesktopProviderConnection(input: {
  providerId: DesktopLocalCliProviderId
  model: string
}) {
  void input
  return getDesktopProviderConnections()
}

export async function clearDesktopProviderConnection(
  providerId: DesktopLocalCliProviderId,
) {
  void providerId
  return getDesktopProviderConnections()
}

async function runCodexPrompt(input: {
  model: string
  prompt: string
  schema?: Record<string, unknown>
}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raincheck-codex-'))
  const outputPath = path.join(tempDir, 'output.txt')
  const schemaPath = path.join(tempDir, 'schema.json')

  try {
    if (input.schema) {
      await writeFile(schemaPath, JSON.stringify(input.schema), 'utf8')
    }

    const args = [
      '--ask-for-approval',
      'never',
      '--sandbox',
      'read-only',
      'exec',
      '--skip-git-repo-check',
      '-C',
      tempDir,
      '--output-last-message',
      outputPath,
    ]

    if (input.schema) {
      args.push('--output-schema', schemaPath)
    }

    args.push('--model', input.model, '-')

    const { stdout } = await spawnCliCapture('codex', args, {
      stdinText: input.prompt,
      timeout: localCliTimeoutMs,
    })

    const outputText = await readFile(outputPath, 'utf8').catch(() => '')

    return outputText.trim() || stdout.trim()
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runClaudePrompt(input: {
  model: string
  prompt: string
  schema?: Record<string, unknown>
}) {
  const args = ['--print', '--model', input.model, '--tools', '']

  if (input.schema) {
    args.push(
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(input.schema),
    )
  }

  const { stdout } = await spawnCliCapture('claude', args, {
    stdinText: input.prompt,
    timeout: localCliTimeoutMs,
    maxBuffer: 1024 * 1024,
  })

  return stdout.trim()
}

async function runLocalCliPrompt(input: {
  providerId: DesktopLocalCliProviderId
  model: string
  prompt: string
  schema?: Record<string, unknown>
}) {
  switch (input.providerId) {
    case 'openai':
      return runCodexPrompt(input)
    case 'anthropic':
      return runClaudePrompt(input)
  }
}

async function postJson<T>(input: {
  apiBaseUrl: string
  path: string
  body: unknown
  parse: (value: unknown) => T
}) {
  const response = await fetch(
    `${trimTrailingSlash(input.apiBaseUrl)}${input.path}`,
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(input.body),
    },
  )

  if (!response.ok) {
    const responseText = await response.text()

    try {
      const parsed = JSON.parse(responseText) as {
        error?: { message?: string }
      }
      throw new Error(
        parsed.error?.message?.trim() ||
          `Request failed with ${response.status}`,
      )
    } catch {
      throw new Error(
        responseText.trim() || `Request failed with ${response.status}`,
      )
    }
  }

  return input.parse(await response.json())
}

async function requestToolPlan(input: {
  providerId: DesktopLocalCliProviderId
  model: string
  prompt: string
}) {
  const output = await runLocalCliPrompt({
    providerId: input.providerId,
    model: input.model,
    prompt: input.prompt,
    schema: toolPlanSchema,
  })

  return parseToolPlan(output)
}

function emitProgress(
  emit: (event: DesktopLocalCliProgressEvent) => void,
  event: DesktopLocalCliProgressEvent,
) {
  emit(parseProgressEvent(event))
}

export async function runDesktopLocalCliChat(
  input: unknown,
  options: {
    emitProgress: (event: DesktopLocalCliProgressEvent) => void
  },
) {
  const parsed = parseChatRequest(input)
  const connections = await getDesktopProviderConnections()
  const providerState = connections.providers.find(
    (provider) => provider.providerId === parsed.providerId,
  )

  if (!providerState?.localCli.detected) {
    throw new Error(
      parsed.providerId === 'openai'
        ? 'Codex CLI is not installed on this desktop.'
        : 'Claude Code is not installed on this desktop.',
    )
  }

  if (!providerState.localCli.authReady) {
    throw new Error(
      parsed.providerId === 'openai'
        ? 'Codex CLI is not signed in yet. Run codex login first.'
        : 'Claude Code is not signed in yet. Run claude auth login first.',
    )
  }

  emitProgress(options.emitProgress, {
    type: 'status',
    label: 'Preparing RainCheck tools',
  })

  const prepare = await postJson({
    apiBaseUrl: parsed.apiBaseUrl,
    path: '/api/desktop/local-cli/prepare',
    body: parsed,
    parse: parsePrepareResponse,
  })
  const session = prepare.session
  const { dataTools, followUpTools } = splitToolCatalog(session.toolCatalog)
  const toolResults: Array<DesktopLocalCliToolResult> = []

  if (dataTools.length > 0) {
    emitProgress(options.emitProgress, {
      type: 'status',
      label: 'Planning weather data',
    })

    let dataPlan = await requestToolPlan({
      providerId: parsed.providerId,
      model: parsed.model,
      prompt: buildPlannerPrompt({
        phase: 'data',
        systemPrompt: session.systemPrompt,
        classification: session.classification,
        messages: session.messages,
        tools: dataTools,
      }),
    })

    if (dataPlan.toolCalls.length === 0) {
      const fallbackPlan = buildDeterministicDataPlan({
        classification: session.classification,
        tools: dataTools,
        defaultLocationQuery: session.answerContext.location?.label,
      })

      if (fallbackPlan.toolCalls.length > 0) {
        dataPlan = fallbackPlan
        emitProgress(options.emitProgress, {
          type: 'status',
          label: 'Using fallback weather tools',
        })
      }
    }

    if (dataPlan.toolCalls.length > 0) {
      const executed = await postJson({
        apiBaseUrl: parsed.apiBaseUrl,
        path: '/api/desktop/local-cli/execute-tools',
        body: {
          session,
          toolCalls: dataPlan.toolCalls,
        },
        parse: parseExecuteToolsResponse,
      })

      for (const event of executed.progressEvents) {
        emitProgress(options.emitProgress, event)
      }
      toolResults.push(...executed.results)
    }
  }

  if (followUpTools.length > 0) {
    emitProgress(options.emitProgress, {
      type: 'status',
      label: 'Planning weather synthesis',
    })

    const followUpPlan = await requestToolPlan({
      providerId: parsed.providerId,
      model: parsed.model,
      prompt: buildPlannerPrompt({
        phase: 'follow-up',
        systemPrompt: session.systemPrompt,
        classification: session.classification,
        messages: session.messages,
        tools: followUpTools,
        priorResults: toolResults,
      }),
    })

    if (followUpPlan.toolCalls.length > 0) {
      const executed = await postJson({
        apiBaseUrl: parsed.apiBaseUrl,
        path: '/api/desktop/local-cli/execute-tools',
        body: {
          session,
          toolCalls: followUpPlan.toolCalls,
        },
        parse: parseExecuteToolsResponse,
      })

      for (const event of executed.progressEvents) {
        emitProgress(options.emitProgress, event)
      }
      toolResults.push(...executed.results)
    }
  }

  emitProgress(options.emitProgress, {
    type: 'status',
    label: 'Writing the answer',
  })

  let responseText = await runLocalCliPrompt({
    providerId: parsed.providerId,
    model: parsed.model,
    prompt: buildFinalAnswerPrompt({
      systemPrompt: session.systemPrompt,
      classification: session.classification,
      messages: session.messages,
      toolResults,
    }),
  })

  if (
    !responseText.trim() ||
    (toolResults.length > 0 && looksLikeMissingDataAnswer(responseText))
  ) {
    responseText = buildFallbackAnswer(toolResults)
  }

  const completed = await postJson({
    apiBaseUrl: parsed.apiBaseUrl,
    path: '/api/desktop/local-cli/complete',
    body: {
      session,
      responseText,
      toolResults,
    },
    parse: parseRunResult,
  })

  return parseRunResult(completed)
}

export async function safeRunDesktopLocalCliChat(
  input: unknown,
  options: {
    emitProgress: (event: DesktopLocalCliProgressEvent) => void
  },
) {
  try {
    return await runDesktopLocalCliChat(input, options)
  } catch (error) {
    emitProgress(options.emitProgress, {
      type: 'status',
      label: readErrorMessage(error),
    })
    throw error
  }
}
