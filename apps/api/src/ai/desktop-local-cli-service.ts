import {
  type DesktopLocalCliProgressEvent,
  type DesktopLocalCliToolCall,
  type DesktopLocalCliToolResult,
  desktopLocalCliCompleteInputSchema,
  desktopLocalCliCompleteResponseSchema,
  desktopLocalCliExecuteToolsInputSchema,
  desktopLocalCliExecuteToolsResponseSchema,
  desktopLocalCliPrepareInputSchema,
  desktopLocalCliPrepareResponseSchema,
  type WeatherAnswerContextSnapshot,
} from '@raincheck/contracts'
import type { ServerTool } from '@tanstack/ai'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { AppError } from '../lib/errors'
import { getConversation, saveMessage } from '../services/conversations-service'
import {
  buildAssistantMessageState,
  persistIncomingUserMessage,
} from './chat-service'
import { classifyConversationRequest } from './classify-request'
import { buildSystemPrompt } from './system-prompt'
import { buildServerTools } from './tools'
import type { WeatherAnswerContext } from './weather-context'

function toWeatherAnswerContext(
  answerContext: WeatherAnswerContextSnapshot,
): WeatherAnswerContext {
  return {
    answerTone: answerContext.answerTone,
    locationHint: answerContext.location ?? undefined,
    displayTimezone:
      answerContext.displayTimezone ?? answerContext.location?.timezone,
    timeDisplay: answerContext.timeDisplay,
  }
}

function serializeToolInputSchema(tool: ServerTool<any, any>) {
  const schema = tool.inputSchema
  if (
    !schema ||
    typeof schema !== 'object' ||
    typeof (schema as z.ZodTypeAny).safeParse !== 'function'
  ) {
    return {}
  }

  try {
    return z.toJSONSchema(schema as z.ZodTypeAny) as Record<string, unknown>
  } catch {
    return {}
  }
}

function buildToolCatalog(tools: Array<ServerTool<any, any>>) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: serializeToolInputSchema(tool),
  }))
}

function buildToolMap(tools: Array<ServerTool<any, any>>) {
  return new Map(tools.map((tool) => [tool.name, tool]))
}

function parseToolArguments(
  tool: ServerTool<any, any>,
  args: Record<string, unknown>,
) {
  const schema = tool.inputSchema as
    | { parse?: (value: unknown) => unknown }
    | undefined

  if (schema?.parse) {
    return schema.parse(args) as Record<string, unknown>
  }

  return args
}

function pseudoIncomingMessages(input: {
  clientMessageId?: string
  message: string
}) {
  return [
    {
      id: input.clientMessageId,
      role: 'user',
      content: input.message,
      parts: [
        {
          type: 'text',
          content: input.message,
          ...(input.clientMessageId
            ? { clientMessageId: input.clientMessageId }
            : {}),
        },
      ],
    },
  ]
}

export async function prepareDesktopLocalCliSession(
  app: FastifyInstance,
  input: unknown,
) {
  const parsed = desktopLocalCliPrepareInputSchema.parse(input)
  const incomingUserTurn = await persistIncomingUserMessage(
    app,
    parsed.conversationId,
    pseudoIncomingMessages({
      clientMessageId: parsed.clientMessageId,
      message: parsed.message,
    }),
  )
  const conversation = await getConversation(app, parsed.conversationId)

  if (!conversation || !incomingUserTurn.userMessageId) {
    throw app.httpErrors.notFound('Conversation not found.')
  }

  const classification = classifyConversationRequest(conversation.messages)
  const weatherAnswerContext = toWeatherAnswerContext(parsed.context)
  const tools = buildServerTools(
    app,
    classification,
    weatherAnswerContext,
    conversation.messages,
  )
  const session = {
    conversationId: parsed.conversationId,
    userMessageId: incomingUserTurn.userMessageId,
    providerId: parsed.providerId,
    model: parsed.model,
    route: {
      provider: parsed.providerId,
      model: parsed.model,
      transport: 'local-cli' as const,
      source: 'desktop-local-cli' as const,
    },
    classification,
    systemPrompt: buildSystemPrompt(classification, weatherAnswerContext),
    messages: conversation.messages,
    toolCatalog: buildToolCatalog(tools),
    answerContext: parsed.context,
  }

  return desktopLocalCliPrepareResponseSchema.parse({
    session,
  })
}

async function executeToolCall(input: {
  toolCall: DesktopLocalCliToolCall
  toolMap: Map<string, ServerTool<any, any>>
}) {
  const tool = input.toolMap.get(input.toolCall.name)

  if (!tool?.execute) {
    throw new Error(
      `Tool is not available for this session: ${input.toolCall.name}`,
    )
  }

  const argumentsValue = parseToolArguments(tool, input.toolCall.arguments)
  const progressEvents: Array<DesktopLocalCliProgressEvent> = [
    {
      type: 'tool-call',
      label: tool.description,
      toolCall: {
        name: tool.name,
        arguments: argumentsValue,
      },
    },
  ]
  const result = await tool.execute(argumentsValue, {
    emitCustomEvent(name, value) {
      if (name !== 'tool-progress') {
        return
      }

      progressEvents.push({
        type: 'status',
        label: String((value as { label?: unknown })?.label ?? tool.name),
      })
    },
  })
  const toolResult: DesktopLocalCliToolResult = {
    name: tool.name,
    arguments: argumentsValue,
    result,
  }

  progressEvents.push({
    type: 'tool-result',
    label: tool.name,
    toolResult,
  })

  return {
    progressEvents,
    toolResult,
  }
}

export async function executeDesktopLocalCliTools(
  app: FastifyInstance,
  input: unknown,
) {
  const parsed = desktopLocalCliExecuteToolsInputSchema.parse(input)
  const weatherAnswerContext = toWeatherAnswerContext(
    parsed.session.answerContext,
  )
  const tools = buildServerTools(
    app,
    parsed.session.classification,
    weatherAnswerContext,
    parsed.session.messages,
  )
  const toolMap = buildToolMap(tools)
  const allowedToolNames = new Set(
    parsed.session.toolCatalog.map((tool) => tool.name),
  )
  const progressEvents: Array<DesktopLocalCliProgressEvent> = []
  const results: Array<DesktopLocalCliToolResult> = []

  for (const toolCall of parsed.toolCalls) {
    if (!allowedToolNames.has(toolCall.name)) {
      throw new AppError(
        400,
        'bad_request',
        `Tool is not allowed for this session: ${toolCall.name}`,
      )
    }

    const executed = await executeToolCall({
      toolCall,
      toolMap,
    })
    progressEvents.push(...executed.progressEvents)
    results.push(executed.toolResult)
  }

  return desktopLocalCliExecuteToolsResponseSchema.parse({
    progressEvents,
    results,
  })
}

export async function completeDesktopLocalCliSession(
  app: FastifyInstance,
  input: unknown,
) {
  const parsed = desktopLocalCliCompleteInputSchema.parse(input)
  const toolOutputs = parsed.toolResults.map((toolResult) => ({
    toolName: toolResult.name,
    result: toolResult.result,
  }))
  const messageState = buildAssistantMessageState({
    text: parsed.responseText,
    toolOutputs,
  })
  const message = await saveMessage(app, {
    conversationId: parsed.session.conversationId,
    role: 'assistant',
    content: parsed.responseText,
    parts: messageState.parts,
    citations: messageState.citations,
    artifacts: messageState.artifacts,
    provider: parsed.session.route.provider,
    model: parsed.session.route.model,
    transport: parsed.session.route.transport,
    source: parsed.session.route.source,
  })

  return desktopLocalCliCompleteResponseSchema.parse({
    message,
    citations: messageState.citations,
    artifacts: messageState.artifacts,
  })
}
