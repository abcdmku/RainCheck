import type { FastifyInstance } from 'fastify'

import { streamResponseToFastify, toSseResponse } from '../ai/chat-service'
import { runtimeHeaders, withRuntimeInfoEvent } from '../runtime/info'

export async function registerChatRoutes(app: FastifyInstance) {
  app.post('/api/chat', async (request, reply) => {
    const rawBody = request.body as {
      conversationId?: string
      messages?: Array<any>
      provider?: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
      model?: string
      displayTimezone?: string
      locationOverride?: {
        label?: string
        latitude?: number
        longitude?: number
        timezone?: string
      }
      data?: {
        conversationId?: string
        provider?: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
        model?: string
        displayTimezone?: string
        locationOverride?: {
          label?: string
          latitude?: number
          longitude?: number
          timezone?: string
        }
      }
    }
    const body = {
      conversationId:
        rawBody.conversationId ?? rawBody.data?.conversationId ?? '',
      messages: Array.isArray(rawBody.messages) ? rawBody.messages : [],
      provider: rawBody.provider ?? rawBody.data?.provider,
      model: rawBody.model ?? rawBody.data?.model,
      displayTimezone: rawBody.displayTimezone ?? rawBody.data?.displayTimezone,
      locationOverride:
        rawBody.locationOverride ?? rawBody.data?.locationOverride,
    }
    const result = await app.raincheckChatHandler(app, body)
    const response = toSseResponse(
      withRuntimeInfoEvent(result.stream, app.raincheckRuntime),
      {
        headers: {
          ...runtimeHeaders(app.raincheckRuntime),
          'x-raincheck-route': JSON.stringify(result.route),
        },
      },
    )
    await streamResponseToFastify(app, reply, response)
  })
}
