import { Readable } from 'node:stream'
import type { Citation, RequestClassification } from '@raincheck/contracts'
import {
  chat,
  maxIterations,
  type StreamChunk,
  toServerSentEventsResponse,
} from '@tanstack/ai'
import { toolCacheMiddleware } from '@tanstack/ai/middlewares'
import type { FastifyInstance } from 'fastify'
import { getConversation, saveMessage } from '../services/conversations-service'
import { getProviderKeyMap, getSettings } from '../services/settings-service'
import { buildAdapter } from './adapters'
import { classifyConversationRequest } from './classify-request'
import { sanitizeToolsForGemini } from './gemini-tool-schemas'
import { chooseRoute } from './provider-routing'
import { buildSystemPrompt } from './system-prompt'
import { buildServerTools } from './tools'
import {
  buildWeatherFallbackText,
  recoverWeatherToolResults,
} from './weather-recovery'
import { normalizeTimingLanguage } from '../weather/timing-language'

function extractTextContent(message: any) {
  if (!message) {
    return ''
  }

  if (typeof message.content === 'string') {
    return message.content
  }

  if (Array.isArray(message.parts)) {
    return message.parts
      .filter((part: { type?: string }) => part.type === 'text')
      .map((part: { content?: string }) => part.content ?? '')
      .join('')
  }

  return ''
}

function sanitizeHistoricalMessageParts(parts: Array<any>) {
  return parts.filter(
    (part) => part?.type !== 'tool-call' && part?.type !== 'tool-result',
  )
}

const geminiToolContextPrefix = 'TOOL RESULT CONTEXT'

const maxGeminiToolIterations = 4

export type CompletedToolResult = {
  toolCallId: string
  toolName: string
  input?: unknown
  result: unknown
}

function hasSynthesisToolResult(toolResults: Array<CompletedToolResult>) {
  return toolResults.some(
    (toolResult) => toolResult.toolName === 'synthesize_weather_conclusion',
  )
}

function stringifyToolResult(result: unknown) {
  try {
    return typeof result === 'string' ? result : JSON.stringify(result)
  } catch {
    return String(result)
  }
}

function fallbackMessageId() {
  return `fallback-${Date.now()}`
}

function duplicateRequestRunId() {
  return `duplicate-${Date.now()}`
}

function fallbackRunId() {
  return `fallback-run-${Date.now()}`
}

function replacementMessageId() {
  return `replacement-${Date.now()}`
}

function replacementRunId() {
  return `replacement-run-${Date.now()}`
}

async function* streamTextFallback(
  text: string,
  model: string,
): AsyncIterable<StreamChunk> {
  const normalizedText = normalizeTimingLanguage(text)
  const timestamp = Date.now()
  const messageId = fallbackMessageId()
  const runId = fallbackRunId()

  yield {
    type: 'RUN_STARTED',
    runId,
    model,
    timestamp,
  } satisfies StreamChunk

  yield {
    type: 'TEXT_MESSAGE_START',
    messageId,
    model,
    timestamp,
    role: 'assistant',
  } satisfies StreamChunk

  yield {
    type: 'TEXT_MESSAGE_CONTENT',
    messageId,
    model,
    timestamp,
    delta: normalizedText,
    content: normalizedText,
  } satisfies StreamChunk

  yield {
    type: 'TEXT_MESSAGE_END',
    messageId,
    model,
    timestamp,
  } satisfies StreamChunk

  yield {
    type: 'RUN_FINISHED',
    runId,
    model,
    timestamp: Date.now(),
    finishReason: 'stop',
  } satisfies StreamChunk
}

function shouldBufferSevereWeatherResponse(
  classification: RequestClassification,
) {
  return classification.intent === 'severe-weather'
}

const severeWeatherRefusalPatterns = [
  /\bcannot provide guidance\b/i,
  /\bcannot help\b/i,
  /\bstorm chasing\b/i,
  /\bintercept(?:ing)? tornado(?:es)?\b/i,
  /\bextreme risks to life and property\b/i,
  /\bsafety-focused weather information\b/i,
] as const

export function isSevereWeatherRefusalText(text: string) {
  const normalized = text.trim()
  if (!normalized) {
    return false
  }

  const hasRefusal =
    /\b(?:cannot|can't|will not|won't|do not)\b/i.test(normalized) &&
    /\b(?:provide|help|assist|support)\b/i.test(normalized)
  const hasStormChaseLanguage = severeWeatherRefusalPatterns.some((pattern) =>
    pattern.test(normalized),
  )

  return hasRefusal && hasStormChaseLanguage
}

function buildSevereWeatherLimitationText(
  classification: RequestClassification,
) {
  switch (classification.chaseGuidanceLevel) {
    case 'full-route':
      return 'RainCheck could not assemble enough live severe-weather evidence to support a route-level chase call yet. Try again after the next radar or model update.'
    case 'exact-target':
      return 'RainCheck could not assemble enough live severe-weather evidence to support an exact town or corridor target yet. Try again after the next radar or model update.'
    case 'general-target':
      return 'RainCheck could not assemble enough live severe-weather evidence to support a starting chase corridor yet. Try again after the next radar or model update.'
    case 'analysis-only':
    default:
      return 'RainCheck could not assemble enough live severe-weather evidence to support a confident setup call yet. Try again after the next radar or model update.'
  }
}

function extractBufferedRunMetadata(
  chunks: Array<StreamChunk>,
  model: string,
) {
  const runStart = chunks.find(
    (chunk): chunk is Extract<StreamChunk, { type: 'RUN_STARTED' }> =>
      chunk.type === 'RUN_STARTED',
  )

  return {
    runId: runStart?.runId ?? replacementRunId(),
    model: String(runStart?.model ?? model),
  }
}

function shouldRecoverBufferedSevereWeatherAnswer(input: {
  text: string
  toolResults: Array<CompletedToolResult>
  hadRunError: boolean
}) {
  if (input.hadRunError) {
    return true
  }

  if (isSevereWeatherRefusalText(input.text)) {
    return true
  }

  return !input.text.trim() && !hasSynthesisToolResult(input.toolResults)
}

async function* streamBufferedWeatherReplacement(input: {
  bufferedChunks: Array<StreamChunk>
  model: string
  replacementText: string
  recoveryResults?: Array<CompletedToolResult>
}) {
  const { runId, model } = extractBufferedRunMetadata(
    input.bufferedChunks,
    input.model,
  )
  const hasRunStarted = input.bufferedChunks.some(
    (chunk) => chunk.type === 'RUN_STARTED',
  )

  if (!hasRunStarted) {
    yield {
      type: 'RUN_STARTED',
      runId,
      model,
      timestamp: Date.now(),
    } satisfies StreamChunk
  }

  for (const chunk of input.bufferedChunks) {
    if (
      isTextMessageChunk(chunk) ||
      chunk.type === 'RUN_FINISHED' ||
      chunk.type === 'RUN_ERROR'
    ) {
      continue
    }

    yield chunk
  }

  for (const toolResult of input.recoveryResults ?? []) {
    yield {
      type: 'TOOL_CALL_END',
      toolCallId: toolResult.toolCallId,
      toolName: toolResult.toolName,
      model,
      timestamp: Date.now(),
      input: toolResult.input,
      result: stringifyToolResult(toolResult.result),
    } satisfies StreamChunk
  }

  const normalizedText = normalizeTimingLanguage(input.replacementText)
  const messageId = replacementMessageId()
  const timestamp = Date.now()

  yield {
    type: 'TEXT_MESSAGE_START',
    messageId,
    model,
    timestamp,
    role: 'assistant',
  } satisfies StreamChunk

  yield {
    type: 'TEXT_MESSAGE_CONTENT',
    messageId,
    model,
    timestamp,
    delta: normalizedText,
    content: normalizedText,
  } satisfies StreamChunk

  yield {
    type: 'TEXT_MESSAGE_END',
    messageId,
    model,
    timestamp,
  } satisfies StreamChunk

  yield {
    type: 'RUN_FINISHED',
    runId,
    model,
    timestamp: Date.now(),
    finishReason: 'stop',
  } satisfies StreamChunk
}

async function* streamDuplicateCompletion(
  model: string,
): AsyncIterable<StreamChunk> {
  yield {
    type: 'RUN_FINISHED',
    runId: duplicateRequestRunId(),
    model,
    timestamp: Date.now(),
    finishReason: 'stop',
  } satisfies StreamChunk
}

function isTextMessageChunk(chunk: StreamChunk) {
  return (
    chunk.type === 'TEXT_MESSAGE_START' ||
    chunk.type === 'TEXT_MESSAGE_CONTENT' ||
    chunk.type === 'TEXT_MESSAGE_END'
  )
}

export function prepareMessagesForProvider(
  messages: Array<any>,
  provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter',
) {
  return messages
    .map((message) => {
      if (!Array.isArray(message?.parts)) {
        return message
      }

      const parts = sanitizeHistoricalMessageParts(message.parts)
      const textContent = extractTextContent({
        ...message,
        parts,
      })

      if (parts.length === 0 && !textContent) {
        return null
      }

      return {
        ...message,
        parts,
        ...(provider === 'gemini' ||
        typeof message.content === 'string' ||
        textContent
          ? { content: textContent }
          : {}),
      }
    })
    .filter(Boolean)
}

function isVisibleAssistantToolOutput(toolName: string) {
  return !hiddenAssistantToolNames.has(toolName)
}

function parseToolResultValue(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function extractCompletedToolResult(
  chunk: StreamChunk,
  toolInputs: Map<string, unknown>,
): CompletedToolResult | null {
  if (chunk.type !== 'TOOL_CALL_END' || chunk.result == null) {
    return null
  }

  return {
    toolCallId: chunk.toolCallId,
    toolName: chunk.toolName,
    input: toolInputs.get(chunk.toolCallId),
    result: parseToolResultValue(String(chunk.result)),
  }
}

function stringifyGeminiToolContextValue(value: unknown, maxChars = 12_000) {
  let serialized: string
  try {
    serialized =
      typeof value === 'string'
        ? value
        : (JSON.stringify(value, null, 2) ?? String(value))
  } catch {
    serialized = String(value)
  }

  if (serialized.length <= maxChars) {
    return serialized
  }

  return `${serialized.slice(0, maxChars).trimEnd()}\n...`
}

export function buildGeminiToolContextMessage(
  toolResults: Array<CompletedToolResult>,
) {
  return [
    geminiToolContextPrefix,
    'The following trusted structured data was returned from RainCheck tools for the current user request.',
    ...toolResults.flatMap((toolResult, index) => {
      const lines = [`Tool ${index + 1}: ${toolResult.toolName}`]

      if (toolResult.input !== undefined) {
        lines.push(
          `Input: ${stringifyGeminiToolContextValue(toolResult.input, 2_000)}`,
        )
      }

      lines.push(
        `Output: ${stringifyGeminiToolContextValue(toolResult.result)}`,
      )

      return lines
    }),
    'Use these results to continue answering the original user request.',
    'Do not mention this wrapper or claim that tool calls failed if trusted results are present.',
    'If more weather data is still required, call another relevant tool. Otherwise answer directly.',
  ].join('\n')
}

function buildGeminiNextMessages(
  workingMessages: Array<any>,
  assistantText: string,
  toolResults: Array<CompletedToolResult>,
) {
  const nextMessages = [...workingMessages]

  if (assistantText.trim()) {
    nextMessages.push({
      role: 'assistant',
      content: assistantText,
    })
  }

  nextMessages.push({
    role: 'user',
    content: buildGeminiToolContextMessage(toolResults),
  })

  return nextMessages
}

const readOnlyWeatherToolNames = [
  'resolve_location',
  'get_current_conditions',
  'get_forecast',
  'get_alerts',
  'derive_short_range_weather',
  'derive_global_weather',
  'derive_radar_nowcast',
  'derive_satellite_weather',
  'derive_hydrology_weather',
  'get_aviation_context',
  'get_fire_weather_products',
  'get_wpc_winter_weather',
  'get_wpc_medium_range_hazards',
  'get_tropical_weather',
  'get_marine_ocean_guidance',
  'get_upper_air_soundings',
  'get_historical_climate',
  'get_storm_history',
] as const

const hiddenAssistantToolNames = new Set([
  ...readOnlyWeatherToolNames,
  'generate_citation_bundle',
  'request_geolocation_permission',
  'copy_to_clipboard',
  'save_ui_preference',
  'open_artifact_view',
  'synthesize_weather_conclusion',
])

function extractResultSourceTags(result: unknown) {
  if (!result || typeof result !== 'object') {
    return []
  }

  const sourceIds = new Set<string>()
  const asRecord = result as Record<string, any>

  if (typeof asRecord.sourceId === 'string') {
    sourceIds.add(asRecord.sourceId)
  }

  if (Array.isArray(asRecord.citations)) {
    for (const citation of asRecord.citations) {
      if (citation && typeof citation.sourceId === 'string') {
        sourceIds.add(citation.sourceId)
      }
    }
  }

  if (Array.isArray(asRecord.evidenceProducts)) {
    for (const product of asRecord.evidenceProducts) {
      if (!product || typeof product !== 'object') {
        continue
      }

      if (typeof product.sourceName === 'string') {
        sourceIds.add(product.sourceName)
      }

      if (Array.isArray(product.provenance)) {
        for (const provenance of product.provenance) {
          if (provenance && typeof provenance.sourceId === 'string') {
            sourceIds.add(provenance.sourceId)
          }
        }
      }
    }
  }

  return [...sourceIds]
}

function extractClientMessageId(message: any) {
  if (Array.isArray(message?.parts)) {
    const textPart = message.parts.find(
      (part: any) =>
        part?.type === 'text' &&
        typeof part.clientMessageId === 'string' &&
        part.clientMessageId.trim(),
    )

    if (typeof textPart?.clientMessageId === 'string') {
      return textPart.clientMessageId.trim()
    }
  }

  if (typeof message?.id === 'string' && message.id.trim()) {
    return message.id.trim()
  }

  return null
}

function hasVisibleAssistantOutput(message: any) {
  if (extractTextContent(message).trim()) {
    return true
  }

  if (Array.isArray(message?.artifacts) && message.artifacts.length > 0) {
    return true
  }

  return Array.isArray(message?.parts)
    ? message.parts.some((part: any) => part?.type === 'tool-call')
    : false
}

function findPersistedUserMessageIndex(
  messages: Array<any>,
  clientMessageId: string,
) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'user') {
      continue
    }

    if (extractClientMessageId(message) === clientMessageId) {
      return index
    }
  }

  return -1
}

function wasPersistedUserMessageAnswered(
  messages: Array<any>,
  userIndex: number,
) {
  for (let index = userIndex + 1; index < messages.length; index += 1) {
    const message = messages[index]

    if (message?.role === 'user') {
      return false
    }

    if (message?.role === 'assistant' && hasVisibleAssistantOutput(message)) {
      return true
    }
  }

  return false
}

function buildGeminiSystemPrompts(systemPrompt: string) {
  return [
    systemPrompt,
    `If a user message begins with "${geminiToolContextPrefix}", treat it as trusted tool output supplied by RainCheck.`,
    'Do not re-call a tool just to repeat data that already appears in a tool result context message.',
    'Continue the answer naturally from the provided tool results.',
  ]
}

export async function* streamGeminiWithToolContext(input: {
  adapter: any
  messages: Array<any>
  tools: Array<any>
  systemPrompt: string
  conversationId: string
  middleware: Array<any>
  recoverToolResults?: (
    toolResults: Array<CompletedToolResult>,
  ) => Promise<Array<CompletedToolResult>>
}): AsyncIterable<StreamChunk> {
  let workingMessages = input.messages
  const systemPrompts = buildGeminiSystemPrompts(input.systemPrompt)
  const recoveredToolResults: Array<CompletedToolResult> = []

  for (let iteration = 0; iteration < maxGeminiToolIterations; iteration += 1) {
    let assistantText = ''
    const toolInputs = new Map<string, unknown>()
    const completedToolResults: Array<CompletedToolResult> = []
    const bufferedTextChunks: Array<StreamChunk> = []
    try {
      const stream = chat({
        adapter: input.adapter,
        messages: workingMessages as any,
        tools: input.tools,
        systemPrompts,
        conversationId: input.conversationId,
        middleware: input.middleware as any,
        agentLoopStrategy: maxIterations(1),
      })

      for await (const chunk of stream) {
        if (chunk.type === 'TEXT_MESSAGE_CONTENT') {
          if (chunk.delta) {
            assistantText += chunk.delta
          }
          bufferedTextChunks.push(chunk)
          continue
        }

        if (isTextMessageChunk(chunk)) {
          bufferedTextChunks.push(chunk)
          continue
        }

        if (chunk.type === 'TOOL_CALL_END' && chunk.input !== undefined) {
          toolInputs.set(chunk.toolCallId, chunk.input)
        }

        const toolResult = extractCompletedToolResult(chunk, toolInputs)
        if (toolResult) {
          completedToolResults.push(toolResult)
        }

        yield chunk
      }
    } catch (error) {
      const recoveryResults =
        (await input.recoverToolResults?.([
          ...recoveredToolResults,
          ...completedToolResults,
        ])) ?? []
      recoveredToolResults.push(...recoveryResults)

      for (const toolResult of recoveryResults) {
        yield {
          type: 'TOOL_CALL_END',
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          model: String(input.adapter?.model ?? 'gemini'),
          timestamp: Date.now(),
          input: toolResult.input,
          result: stringifyToolResult(toolResult.result),
        } satisfies StreamChunk
      }

      const fallbackText = buildWeatherFallbackText([
        ...recoveredToolResults,
        ...completedToolResults,
      ])
      if (fallbackText) {
        yield* streamTextFallback(
          fallbackText,
          String(input.adapter?.model ?? 'gemini'),
        )
        return
      }

      throw error
    }

    recoveredToolResults.push(...completedToolResults)

    if (completedToolResults.length === 0) {
      const recoveryResults =
        (await input.recoverToolResults?.([...recoveredToolResults])) ?? []
      recoveredToolResults.push(...recoveryResults)

      for (const toolResult of recoveryResults) {
        yield {
          type: 'TOOL_CALL_END',
          toolCallId: toolResult.toolCallId,
          toolName: toolResult.toolName,
          model: String(input.adapter?.model ?? 'gemini'),
          timestamp: Date.now(),
          input: toolResult.input,
          result: stringifyToolResult(toolResult.result),
        } satisfies StreamChunk
      }

      const fallbackText = buildWeatherFallbackText(recoveredToolResults)
      if (fallbackText) {
        yield* streamTextFallback(
          fallbackText,
          String(input.adapter?.model ?? 'gemini'),
        )
        return
      }

      if (recoveryResults.length > 0) {
        workingMessages = buildGeminiNextMessages(
          workingMessages,
          assistantText,
          [...recoveredToolResults],
        )
        continue
      }

      for (const chunk of bufferedTextChunks) {
        yield chunk
      }

      return
    }

    const recoveryResults =
      (await input.recoverToolResults?.([...recoveredToolResults])) ?? []
    recoveredToolResults.push(...recoveryResults)

    for (const toolResult of recoveryResults) {
      yield {
        type: 'TOOL_CALL_END',
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        model: String(input.adapter?.model ?? 'gemini'),
        timestamp: Date.now(),
        input: toolResult.input,
        result: stringifyToolResult(toolResult.result),
      } satisfies StreamChunk
    }

    const fallbackText = buildWeatherFallbackText(recoveredToolResults)
    if (fallbackText && hasSynthesisToolResult(recoveredToolResults)) {
      yield* streamTextFallback(
        fallbackText,
        String(input.adapter?.model ?? 'gemini'),
      )
      return
    }

    workingMessages = buildGeminiNextMessages(workingMessages, assistantText, [
      ...recoveredToolResults,
    ])
  }

  const synthesisStream = chat({
    adapter: input.adapter,
    messages: workingMessages as any,
    tools: [],
    systemPrompts,
    conversationId: input.conversationId,
    middleware: input.middleware as any,
    agentLoopStrategy: maxIterations(1),
  })
  try {
    for await (const chunk of synthesisStream) {
      yield chunk
    }
  } catch (error) {
    const recoveryResults =
      (await input.recoverToolResults?.([...recoveredToolResults])) ?? []
    recoveredToolResults.push(...recoveryResults)

    for (const toolResult of recoveryResults) {
      yield {
        type: 'TOOL_CALL_END',
        toolCallId: toolResult.toolCallId,
        toolName: toolResult.toolName,
        model: String(input.adapter?.model ?? 'gemini'),
        timestamp: Date.now(),
        input: toolResult.input,
        result: stringifyToolResult(toolResult.result),
      } satisfies StreamChunk
    }

    const fallbackText = buildWeatherFallbackText(recoveredToolResults)
    if (fallbackText) {
      yield* streamTextFallback(
        fallbackText,
        String(input.adapter?.model ?? 'gemini'),
      )
      return
    }

    throw error
  }
}

export async function* streamValidatedSevereWeatherResponse(input: {
  stream: AsyncIterable<StreamChunk>
  classification: RequestClassification
  route: {
    provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
    model: string
  }
  latestText: string
  recoverToolResults: (
    toolResults: Array<CompletedToolResult>,
  ) => Promise<Array<CompletedToolResult>>
}): AsyncIterable<StreamChunk> {
  if (!shouldBufferSevereWeatherResponse(input.classification)) {
    yield* input.stream
    return
  }

  const bufferedChunks: Array<StreamChunk> = []
  const toolInputs = new Map<string, unknown>()
  const completedToolResults: Array<CompletedToolResult> = []
  let assistantText = ''
  let hadRunError = false

  try {
    for await (const chunk of input.stream) {
      bufferedChunks.push(chunk)

      if (chunk.type === 'TEXT_MESSAGE_CONTENT' && chunk.delta) {
        assistantText += chunk.delta
      }

      if (chunk.type === 'TOOL_CALL_END' && chunk.input !== undefined) {
        toolInputs.set(chunk.toolCallId, chunk.input)
      }

      const toolResult = extractCompletedToolResult(chunk, toolInputs)
      if (toolResult) {
        completedToolResults.push(toolResult)
      }

      if (chunk.type === 'RUN_ERROR') {
        hadRunError = true
      }
    }
  } catch {
    hadRunError = true
  }

  if (
    !shouldRecoverBufferedSevereWeatherAnswer({
      text: assistantText,
      toolResults: completedToolResults,
      hadRunError,
    })
  ) {
    for (const chunk of bufferedChunks) {
      yield chunk
    }
    return
  }

  const recoveryResults = await input.recoverToolResults(completedToolResults)
  const fallbackText =
    buildWeatherFallbackText([...completedToolResults, ...recoveryResults]) ??
    buildSevereWeatherLimitationText(input.classification)

  yield* streamBufferedWeatherReplacement({
    bufferedChunks,
    model: input.route.model,
    replacementText: fallbackText,
    recoveryResults,
  })
}

function buildMiddleware(app: FastifyInstance) {
  return [
    toolCacheMiddleware({
      ttl: 2 * 60 * 1000,
      toolNames: [...readOnlyWeatherToolNames],
    }),
    {
      name: 'raincheck-logging',
      onStart(ctx: any) {
        app.log.info({ requestId: ctx.requestId }, 'chat started')
      },
      onBeforeToolCall(_ctx: any, info: any) {
        app.log.info(
          { tool: info.toolName, args: info.args },
          'tool call started',
        )
      },
      onAfterToolCall(_ctx: any, info: any) {
        app.log.info(
          {
            tool: info.toolName,
            ok: info.ok,
            duration: info.duration,
            sources: extractResultSourceTags(info.result),
          },
          'tool call finished',
        )
      },
      onFinish(ctx: any, info: any) {
        app.log.info(
          {
            requestId: ctx.requestId,
            duration: info.duration,
            usage: info.usage,
          },
          'chat finished',
        )
      },
    },
  ]
}

async function persistIncomingUserMessage(
  app: FastifyInstance,
  conversationId: string,
  messages: Array<any>,
) {
  const lastUserMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'user')
  const userContent = extractTextContent(lastUserMessage).trim()
  const clientMessageId = extractClientMessageId(lastUserMessage)
  if (!userContent) {
    return {
      alreadyAnswered: false,
      clientMessageId,
      text: '',
    }
  }

  const conversation = await getConversation(app, conversationId)
  if (conversation && clientMessageId) {
    const duplicateUserIndex = findPersistedUserMessageIndex(
      conversation.messages,
      clientMessageId,
    )

    if (duplicateUserIndex >= 0) {
      return {
        alreadyAnswered: wasPersistedUserMessageAnswered(
          conversation.messages,
          duplicateUserIndex,
        ),
        clientMessageId,
        text: userContent,
      }
    }
  }

  const lastPersisted = conversation?.messages.at(-1)
  if (
    lastPersisted?.role === 'user' &&
    lastPersisted.content.trim() === userContent
  ) {
    return {
      alreadyAnswered: false,
      clientMessageId,
      text: userContent,
    }
  }

  await saveMessage(app, {
    conversationId,
    role: 'user',
    content: userContent,
    parts: [
      {
        type: 'text',
        content: userContent,
        ...(clientMessageId ? { clientMessageId } : {}),
      },
    ],
  })

  return {
    alreadyAnswered: false,
    clientMessageId,
    text: userContent,
  }
}

function collectAssistantArtifacts(
  toolOutputs: Array<{ toolName: string; result: any }>,
) {
  const artifacts: Array<Record<string, unknown>> = []

  for (const entry of toolOutputs) {
    const result = entry.result
    if (!result || typeof result !== 'object') {
      continue
    }

    if (Array.isArray(result.artifacts)) {
      for (const artifact of result.artifacts) {
        if (!artifact || typeof artifact !== 'object') {
          continue
        }

        artifacts.push(normalizeArtifactManifest(artifact))
      }
    }

    const recommendedArtifacts = Array.isArray(result.recommendedArtifacts)
      ? result.recommendedArtifacts
      : []
    for (const artifact of recommendedArtifacts) {
      if (!artifact || typeof artifact !== 'object') {
        continue
      }

      artifacts.push(normalizeArtifactManifest(artifact))
    }

    const evidenceArtifacts = Array.isArray(result.evidenceProducts)
      ? result.evidenceProducts.flatMap((product: any) =>
          Array.isArray(product?.artifactHandles) ? product.artifactHandles : [],
        )
      : []
    for (const artifact of evidenceArtifacts) {
      if (!artifact || typeof artifact !== 'object') {
        continue
      }

      artifacts.push(normalizeArtifactManifest(artifact))
    }

    if ('artifactId' in result && 'href' in result) {
      artifacts.push(
        normalizeArtifactManifest({
          id: result.artifactId,
          type: toArtifactType(String(result.artifactType ?? entry.toolName)),
          title: result.title ?? 'Weather artifact',
          description: result.title ?? 'Generated weather artifact',
          mimeType: result.mimeType ?? 'application/octet-stream',
          href: result.href,
          createdAt: result.createdAt ?? new Date().toISOString(),
          sourceIds: Array.isArray(result.sourceIds) ? result.sourceIds : [],
        }),
      )
    }
  }

  const deduped = new Map<string, Record<string, unknown>>()
  for (const artifact of artifacts) {
    deduped.set(String(artifact.id), artifact)
  }

  return [...deduped.values()]
}

export function collectAssistantCitations(
  toolOutputs: Array<{ toolName: string; result: any }>,
) {
  const citations: Array<Record<string, unknown>> = []

  for (const entry of toolOutputs) {
    const result = entry.result
    if (Array.isArray(result)) {
      for (const item of result) {
        collectCitationLike(item, citations)
      }
      continue
    }

    collectCitationLike(result, citations)
    if (Array.isArray(result.evidenceProducts)) {
      for (const evidence of result.evidenceProducts) {
        if (evidence && typeof evidence === 'object') {
          collectCitationLike(evidence, citations)
          if (Array.isArray((evidence as any).provenance)) {
            for (const provenance of (evidence as any).provenance) {
              if (provenance && typeof provenance === 'object') {
                const normalized = normalizeProvenanceCitation(provenance)
                if (normalized) {
                  citations.push(normalized)
                }
              }
            }
          }
        }
      }
    }
  }

  const deduped = new Map<string, Record<string, unknown>>()
  for (const citation of citations) {
    const key =
      typeof citation.id === 'string'
        ? citation.id
        : `${citation.sourceId ?? 'source'}:${citation.productId ?? 'product'}:${citation.url ?? citation.contextUrl ?? citation.displayUrl ?? ''}:${citation.kind ?? 'page'}`
    const existing = deduped.get(key)
    if (!existing) {
      deduped.set(key, citation)
      continue
    }

    const preferred = compareCitations(citation, existing) < 0 ? citation : existing
    const fallback = preferred === citation ? existing : citation
    deduped.set(key, mergeCitation(preferred, fallback))
  }

  return [...deduped.values()].sort(compareCitations)
}

function collectCitationLike(
  value: unknown,
  citations: Array<Record<string, unknown>>,
) {
  if (!value || typeof value !== 'object') {
    return
  }

  if (Array.isArray((value as any).citations)) {
    for (const citation of (value as any).citations) {
      if (citation && typeof citation === 'object') {
        const normalized = normalizeCitationLike(citation as Record<string, unknown>)
        if (normalized) {
          citations.push(normalized)
        }
      }
    }
  }

  const source = (value as any).source
  if (source && typeof source === 'object') {
    const normalized = normalizeCitationLike(source as Record<string, unknown>)
    if (normalized) {
      citations.push(normalized)
    }
  }
}

const citationKindPriority: Record<Citation['kind'], number> = {
  image: 0,
  dataset: 1,
  api: 2,
  page: 3,
  artifact: 4,
  derived: 5,
}

function citationKindRank(citation: Record<string, unknown>) {
  const kind =
    typeof citation.kind === 'string' &&
    citation.kind in citationKindPriority
      ? (citation.kind as Citation['kind'])
      : 'page'
  return citationKindPriority[kind]
}

function citationSortLabel(citation: Record<string, unknown>) {
  return typeof citation.label === 'string'
    ? citation.label.toLowerCase()
    : String(citation.sourceId ?? 'source').toLowerCase()
}

function compareCitations(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  const rankDiff = citationKindRank(left) - citationKindRank(right)
  if (rankDiff !== 0) {
    return rankDiff
  }

  return citationSortLabel(left).localeCompare(citationSortLabel(right))
}

function normalizeCitationLike(
  citation: Record<string, unknown>,
): Record<string, unknown> | null {
  const kind =
    typeof citation.kind === 'string' &&
    citation.kind in citationKindPriority
      ? citation.kind
      : 'page'
  if (kind === 'derived') {
    return null
  }

  const url = typeof citation.url === 'string' ? citation.url : undefined
  const contextUrl =
    typeof citation.contextUrl === 'string' ? citation.contextUrl : undefined
  const displayUrl =
    typeof citation.displayUrl === 'string' ? citation.displayUrl : undefined
  if (!url && !contextUrl && !displayUrl) {
    return null
  }

  return {
    ...(citation as Record<string, unknown>),
    kind,
    url,
    contextUrl,
    displayUrl,
  }
}

function normalizeProvenanceCitation(
  provenance: Record<string, unknown>,
): Record<string, unknown> | null {
  return normalizeCitationLike({
    id:
      typeof provenance.id === 'string'
        ? provenance.id
        : `${provenance.sourceId ?? 'source'}:${provenance.productId ?? 'product'}`,
    label:
      typeof provenance.label === 'string'
        ? provenance.label
        : String(provenance.sourceId ?? 'Weather source'),
    sourceId: String(provenance.sourceId ?? 'source'),
    productId: String(provenance.productId ?? 'product'),
    kind:
      typeof provenance.kind === 'string'
        ? provenance.kind
        : 'page',
    url: typeof provenance.url === 'string' ? provenance.url : undefined,
    contextUrl:
      typeof provenance.contextUrl === 'string'
        ? provenance.contextUrl
        : undefined,
    displayUrl:
      typeof provenance.displayUrl === 'string'
        ? provenance.displayUrl
        : undefined,
    issuedAt:
      typeof provenance.issuedAt === 'string'
        ? provenance.issuedAt
        : undefined,
    validAt:
      typeof provenance.validAt === 'string'
        ? provenance.validAt
        : undefined,
  })
}

function mergeCitation(
  preferred: Record<string, unknown>,
  fallback: Record<string, unknown>,
) {
  return {
    ...preferred,
    displayUrl:
      typeof preferred.displayUrl === 'string' && preferred.displayUrl
        ? preferred.displayUrl
        : typeof fallback.displayUrl === 'string'
          ? fallback.displayUrl
          : undefined,
    url:
      typeof preferred.url === 'string' && preferred.url
        ? preferred.url
        : typeof fallback.url === 'string'
          ? fallback.url
          : undefined,
    contextUrl:
      typeof preferred.contextUrl === 'string' && preferred.contextUrl
        ? preferred.contextUrl
        : typeof fallback.contextUrl === 'string'
          ? fallback.contextUrl
          : undefined,
    issuedAt:
      typeof preferred.issuedAt === 'string'
        ? preferred.issuedAt
        : typeof fallback.issuedAt === 'string'
          ? fallback.issuedAt
          : undefined,
    validAt:
      typeof preferred.validAt === 'string'
        ? preferred.validAt
        : typeof fallback.validAt === 'string'
          ? fallback.validAt
          : undefined,
    note:
      typeof preferred.note === 'string'
        ? preferred.note
        : typeof fallback.note === 'string'
          ? fallback.note
          : undefined,
  }
}

function toArtifactType(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes('radar')) {
    return 'radar-loop'
  }
  if (normalized.includes('satellite')) {
    return 'satellite-loop'
  }
  if (normalized.includes('report') || normalized.includes('brief')) {
    return 'report'
  }
  if (
    normalized.includes('single-model-panel') ||
    normalized.includes('hodograph') ||
    normalized.includes('time-height') ||
    normalized.includes('skewt')
  ) {
    return 'chart'
  }
  return 'chart'
}

function normalizeArtifactManifest(value: Record<string, unknown>) {
  return {
    id: String(value.id ?? value.artifactId ?? `artifact-${Date.now()}`),
    type: toArtifactType(String(value.type ?? value.artifactType ?? 'chart')),
    title: String(value.title ?? 'Weather artifact'),
    description: String(
      value.description ?? value.title ?? 'Generated weather artifact',
    ),
    mimeType: String(value.mimeType ?? 'application/octet-stream'),
    href: String(value.href ?? ''),
    createdAt: String(value.createdAt ?? new Date().toISOString()),
    sourceIds: Array.isArray(value.sourceIds)
      ? value.sourceIds.map((sourceId) => String(sourceId))
      : [],
  }
}

async function* streamAndPersist(
  app: FastifyInstance,
  input: {
    conversationId: string
    route: {
      provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
      model: string
    }
    stream: AsyncIterable<StreamChunk>
  },
) {
  let text = ''
  const toolOutputs: Array<{ toolName: string; result: unknown }> = []

  for await (const chunk of input.stream) {
    if (chunk.type === 'TEXT_MESSAGE_CONTENT' && chunk.delta) {
      text += chunk.delta
    }

    const toolResult = extractCompletedToolResult(chunk, new Map())
    if (toolResult) {
      toolOutputs.push({
        toolName: toolResult.toolName,
        result: toolResult.result,
      })
    }

    yield chunk
  }

  const artifacts = collectAssistantArtifacts(toolOutputs)
  const citations = collectAssistantCitations(toolOutputs)
  const visibleToolOutputs = toolOutputs.filter((output) =>
    isVisibleAssistantToolOutput(output.toolName),
  )
  const parts = [
    { type: 'text', content: text },
    ...visibleToolOutputs.map((output, index) => ({
      type: 'tool-call',
      id: `tool-${index}`,
      name: output.toolName,
      arguments: '{}',
      state: 'input-complete',
      output: output.result,
    })),
  ]

  await saveMessage(app, {
    conversationId: input.conversationId,
    role: 'assistant',
    content: text,
    parts,
    citations,
    artifacts,
    provider: input.route.provider,
    model: input.route.model,
  })
}

export async function handleChatRequest(
  app: FastifyInstance,
  body: {
    conversationId: string
    messages: Array<any>
    provider?: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
    model?: string
    locationOverride?: {
      label?: string
      latitude?: number
      longitude?: number
    }
  },
) {
  const incomingUserTurn = await persistIncomingUserMessage(
    app,
    body.conversationId,
    body.messages,
  )

  const latestMessage = [...body.messages]
    .reverse()
    .find((message) => message.role === 'user')
  const latestText = incomingUserTurn.text || extractTextContent(latestMessage)
  const classification = classifyConversationRequest(body.messages)
  const settings = await getSettings(app)
  const keyMap = await getProviderKeyMap(app)
  const route = chooseRoute({
    env: app.raincheckEnv,
    taskClass: classification.taskClass,
    settings,
    keyMap,
    requestedProvider: body.provider,
    requestedModel: body.model,
  })

  if (incomingUserTurn.alreadyAnswered) {
    return {
      route,
      classification,
      stream: streamDuplicateCompletion(route.model),
    }
  }

  const adapter = await buildAdapter(app, route)
  const tools = buildServerTools(app, classification)
  const providerTools =
    route.provider === 'gemini' ? sanitizeToolsForGemini(tools) : tools
  const preparedMessages = prepareMessagesForProvider(
    body.messages,
    route.provider,
  )
  const systemPrompt = buildSystemPrompt(classification, body.locationOverride)
  const middleware = buildMiddleware(app)
  const recoverToolResults = (toolResults: Array<CompletedToolResult>) =>
    recoverWeatherToolResults(app, classification, latestText, toolResults)
  const baseStream =
    route.provider === 'gemini'
      ? streamGeminiWithToolContext({
          adapter,
          messages: preparedMessages,
          tools: providerTools,
          systemPrompt,
          conversationId: body.conversationId,
          middleware,
          recoverToolResults,
        })
      : chat({
          adapter,
          messages: preparedMessages as any,
          tools: providerTools,
          systemPrompts: [systemPrompt],
          conversationId: body.conversationId,
          middleware: middleware as any,
          agentLoopStrategy: maxIterations(8),
        })
  const stream = streamValidatedSevereWeatherResponse({
    stream: baseStream,
    classification,
    route,
    latestText,
    recoverToolResults,
  })

  return {
    route,
    classification,
    stream: streamAndPersist(app, {
      conversationId: body.conversationId,
      route,
      stream,
    }),
  }
}

export async function streamResponseToFastify(
  app: FastifyInstance,
  reply: any,
  response: Response,
) {
  reply.hijack()
  reply.raw.writeHead(
    response.status,
    Object.fromEntries(response.headers.entries()),
  )

  if (response.body) {
    Readable.fromWeb(response.body as any).pipe(reply.raw)
  } else {
    reply.raw.end()
  }

  return app
}

export function toSseResponse(stream: AsyncIterable<StreamChunk>) {
  return toServerSentEventsResponse(stream)
}
