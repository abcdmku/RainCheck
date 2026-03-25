import {
  artifactManifestSchema,
  citationSchema,
  conversationSchema,
  createConversationInputSchema,
  messageRecordSchema,
} from '@raincheck/contracts'
import { asc, desc, eq } from 'drizzle-orm'

import type { FastifyInstance } from 'fastify'

import { conversationsTable, messagesTable } from '../db/schema'
import { makeId, nowIso } from '../lib/time'

export async function listConversations(app: FastifyInstance) {
  const conversations = await app.raincheckDb
    .select()
    .from(conversationsTable)
    .orderBy(desc(conversationsTable.updatedAt))

  const previews = await app.raincheckDb
    .select()
    .from(messagesTable)
    .orderBy(desc(messagesTable.createdAt))

  const previewMap = new Map<string, string>()
  for (const message of previews) {
    if (message.role !== 'user' && message.role !== 'assistant') {
      continue
    }

    if (!previewMap.has(message.conversationId)) {
      previewMap.set(message.conversationId, message.content)
    }
  }

  return conversations.map((conversation) =>
    conversationSchema.parse({
      id: conversation.id,
      title: conversation.title,
      pinned: conversation.pinned,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      latestPreview: previewMap.get(conversation.id) ?? null,
    }),
  )
}

export async function createConversation(app: FastifyInstance, input: unknown) {
  const parsed = createConversationInputSchema.parse(input)
  const now = nowIso()
  const conversation = {
    id: makeId('thread'),
    title: parsed.title ?? 'New weather thread',
    createdAt: now,
    updatedAt: now,
  }

  await app.raincheckDb.insert(conversationsTable).values(conversation)
  return conversationSchema.parse({
    ...conversation,
    pinned: false,
    latestPreview: null,
  })
}

export async function getConversation(
  app: FastifyInstance,
  conversationId: string,
) {
  const [conversation] = await app.raincheckDb
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))

  if (!conversation) {
    return null
  }

  const messages = await app.raincheckDb
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(asc(messagesTable.createdAt))

  return {
    conversation: conversationSchema.parse({
      id: conversation.id,
      title: conversation.title,
      pinned: conversation.pinned,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      latestPreview: messages.at(-1)?.content ?? null,
    }),
    messages: messages.map((message) =>
      messageRecordSchema.parse({
        id: message.id,
        conversationId: message.conversationId,
        role: message.role,
        content: message.content,
        parts: JSON.parse(message.partsJson),
        citations: zodArrayParse(
          JSON.parse(message.citationsJson),
          citationSchema,
        ),
        artifacts: zodArrayParse(
          JSON.parse(message.artifactsJson),
          artifactManifestSchema,
        ),
        createdAt: message.createdAt,
        provider: message.provider,
        model: message.model,
      }),
    ),
  }
}

export async function updateConversation(
  app: FastifyInstance,
  conversationId: string,
  updates: { title?: string; pinned?: boolean },
) {
  const [conversation] = await app.raincheckDb
    .select()
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))

  if (!conversation) {
    return null
  }

  const now = nowIso()
  const set: Record<string, unknown> = { updatedAt: now }
  if (updates.title !== undefined) set.title = updates.title
  if (updates.pinned !== undefined) set.pinned = updates.pinned

  await app.raincheckDb
    .update(conversationsTable)
    .set(set)
    .where(eq(conversationsTable.id, conversationId))

  return conversationSchema.parse({
    id: conversation.id,
    title: updates.title ?? conversation.title,
    pinned: updates.pinned ?? conversation.pinned,
    createdAt: conversation.createdAt,
    updatedAt: now,
    latestPreview: null,
  })
}

export async function deleteConversation(
  app: FastifyInstance,
  conversationId: string,
) {
  const [conversation] = await app.raincheckDb
    .select({
      id: conversationsTable.id,
    })
    .from(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))

  if (!conversation) {
    return false
  }

  await app.raincheckDb
    .delete(conversationsTable)
    .where(eq(conversationsTable.id, conversationId))

  return true
}

function zodArrayParse<T>(
  values: Array<unknown>,
  schema: { parse: (value: unknown) => T },
) {
  return values.map((value) => schema.parse(value))
}

export async function saveMessage(
  app: FastifyInstance,
  input: {
    conversationId: string
    role: 'user' | 'assistant' | 'system'
    content: string
    parts?: Array<Record<string, unknown>>
    citations?: Array<unknown>
    artifacts?: Array<unknown>
    provider?: string | null
    model?: string | null
  },
) {
  const now = nowIso()
  await app.raincheckDb.insert(messagesTable).values({
    id: makeId('msg'),
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
    partsJson: JSON.stringify(input.parts ?? []),
    citationsJson: JSON.stringify(input.citations ?? []),
    artifactsJson: JSON.stringify(input.artifacts ?? []),
    provider: input.provider ?? null,
    model: input.model ?? null,
    createdAt: now,
  })

  await app.raincheckDb
    .update(conversationsTable)
    .set({
      updatedAt: now,
      title:
        input.role === 'user' && input.content
          ? input.content.slice(0, 60)
          : undefined,
    })
    .where(eq(conversationsTable.id, input.conversationId))
}
