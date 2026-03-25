import { createConversationInputSchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  updateConversation,
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

  app.patch('/api/conversations/:id', async (request, reply) => {
    const params = request.params as { id: string }
    const body = request.body as { title?: string; pinned?: boolean }

    const updates: { title?: string; pinned?: boolean } = {}
    if (typeof body.title === 'string') updates.title = body.title.trim()
    if (typeof body.pinned === 'boolean') updates.pinned = body.pinned

    if (!updates.title && updates.pinned === undefined) {
      reply.status(400)
      return { error: 'Provide title or pinned' }
    }

    const result = await updateConversation(app, params.id, updates)
    if (!result) {
      reply.status(404)
      return { error: 'Conversation not found' }
    }

    return { conversation: result }
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
