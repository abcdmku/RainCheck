import { createConversationInputSchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import {
  createConversation,
  deleteConversation,
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

  app.delete('/api/conversations/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const deleted = await deleteConversation(app, params.id)
    if (!deleted) {
      reply.status(404)
      return { error: 'Conversation not found' }
    }

    return reply.status(204).send()
  })
}
