import { createConversationInputSchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import {
  createConversation,
  getConversation,
  listConversations,
} from '../services/conversations-service'

export async function registerConversationRoutes(app: FastifyInstance) {
  app.get('/api/conversations', async () => ({
    conversations: await listConversations(app),
  }))

  app.post('/api/conversations', async (request) => ({
    conversation: await createConversation(
      app,
      createConversationInputSchema.parse(request.body ?? {}),
    ),
  }))

  app.get('/api/conversations/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const conversation = await getConversation(app, params.id)
    if (!conversation) {
      reply.status(404)
      return { error: 'Conversation not found' }
    }

    return conversation
  })
}
