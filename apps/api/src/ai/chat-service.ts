import { Readable } from 'node:stream'
import type { RequestClassification } from '@raincheck/contracts'
import {
  chat,
  type StreamChunk,
  toServerSentEventsResponse,
} from '@tanstack/ai'
import type { FastifyInstance } from 'fastify'
import { getConversation, saveMessage } from '../services/conversations-service'
import { getProviderKeyMap, getSettings } from '../services/settings-service'
import { buildAdapter } from './adapters'
import { classifyRequest } from './classify-request'
import { chooseRoute } from './provider-routing'
import { buildSystemPrompt } from './system-prompt'
import { buildServerTools } from './tools'

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

function buildMiddleware(app: FastifyInstance) {
  return [
    {
      name: 'raincheck-logging',
      onStart(ctx: any) {
        app.log.info({ requestId: ctx.requestId }, 'chat started')
      },
      onBeforeToolCall(_ctx: any, info: any) {
        app.log.info({ tool: info.toolName }, 'tool call started')
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
  const userContent = extractTextContent(lastUserMessage)
  if (!userContent) {
    return
  }

  const conversation = await getConversation(app, conversationId)
  const lastPersisted = conversation?.messages.at(-1)
  if (
    lastPersisted?.role === 'user' &&
    lastPersisted.content.trim() === userContent.trim()
  ) {
    return
  }

  await saveMessage(app, {
    conversationId,
    role: 'user',
    content: userContent,
    parts: [{ type: 'text', content: userContent }],
  })
}

function collectAssistantArtifacts(
  toolOutputs: Array<{ toolName: string; result: unknown }>,
) {
  return toolOutputs
    .filter((entry) => entry.toolName === 'generate_artifact')
    .map((entry) => entry.result)
}

function collectAssistantCitations(
  toolOutputs: Array<{ toolName: string; result: any }>,
) {
  const citationResult = toolOutputs.find(
    (entry) => entry.toolName === 'generate_citation_bundle',
  )
  return citationResult?.result?.citations ?? []
}

async function* streamAndPersist(
  app: FastifyInstance,
  input: {
    conversationId: string
    route: {
      provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
      model: string
    }
    classification: RequestClassification
    stream: AsyncIterable<StreamChunk>
  },
) {
  let text = ''
  const toolOutputs: Array<{ toolName: string; result: unknown }> = []

  for await (const chunk of input.stream) {
    if (chunk.type === 'TEXT_MESSAGE_CONTENT' && chunk.delta) {
      text += chunk.delta
    }

    if (chunk.type === 'TOOL_CALL_END') {
      try {
        toolOutputs.push({
          toolName: chunk.toolName,
          result: JSON.parse(String(chunk.result)),
        })
      } catch {
        toolOutputs.push({
          toolName: chunk.toolName,
          result: chunk.result,
        })
      }
    }

    yield chunk
  }

  const artifacts = collectAssistantArtifacts(toolOutputs)
  const citations = collectAssistantCitations(toolOutputs)
  const parts = [
    { type: 'text', content: text },
    ...toolOutputs.map((output, index) => ({
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
  },
) {
  await persistIncomingUserMessage(app, body.conversationId, body.messages)

  const latestMessage = [...body.messages]
    .reverse()
    .find((message) => message.role === 'user')
  const latestText = extractTextContent(latestMessage)
  const classification = classifyRequest(latestText)
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

  const adapter = await buildAdapter(app, route)
  const tools = buildServerTools(app, classification)
  const stream = chat({
    adapter,
    messages: body.messages as any,
    tools,
    systemPrompts: [buildSystemPrompt(classification)],
    conversationId: body.conversationId,
    middleware: buildMiddleware(app) as any,
  })

  return {
    route,
    classification,
    stream: streamAndPersist(app, {
      conversationId: body.conversationId,
      route,
      classification,
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
