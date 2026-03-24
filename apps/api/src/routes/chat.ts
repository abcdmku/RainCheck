import type { FastifyInstance } from 'fastify'

import { streamResponseToFastify, toSseResponse } from '../ai/chat-service'

export async function registerChatRoutes(app: FastifyInstance) {
  app.post('/api/chat', async (request, reply) => {
    const rawBody = request.body as {
      conversationId?: string
      messages?: Array<any>
      provider?: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
      model?: string
      locationOverride?: {
        label?: string
      }
      data?: {
        conversationId?: string
        provider?: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
        model?: string
        locationOverride?: {
          label?: string
        }
      }
    }
    const body = {
      conversationId:
        rawBody.conversationId ?? rawBody.data?.conversationId ?? '',
      messages: Array.isArray(rawBody.messages) ? rawBody.messages : [],
      provider: rawBody.provider ?? rawBody.data?.provider,
      model: rawBody.model ?? rawBody.data?.model,
      locationOverride: rawBody.locationOverride ?? rawBody.data?.locationOverride,
    }
    const result = await app.raincheckChatHandler(app, body)
    reply.header('x-raincheck-route', JSON.stringify(result.route))
    const response = toSseResponse(result.stream)
    await streamResponseToFastify(app, reply, response)
  })
}
