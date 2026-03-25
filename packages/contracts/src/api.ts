import { z } from 'zod'

import { conversationSchema, messageRecordSchema } from './chat'
import {
  appSettingsSchema,
  type clearProviderKeySchema,
  type storeProviderKeySchema,
  updateAppSettingsSchema,
} from './settings'

export const createConversationResponseSchema = z.object({
  conversation: conversationSchema,
})

export const listConversationsResponseSchema = z.object({
  conversations: z.array(conversationSchema),
})

export const getConversationResponseSchema = z.object({
  conversation: conversationSchema,
  messages: z.array(messageRecordSchema),
})

export const updateSettingsInputSchema = updateAppSettingsSchema
export const updateSettingsResponseSchema = z.object({
  settings: appSettingsSchema,
})

export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  services: z.object({
    api: z.literal('up'),
    database: z.enum(['up', 'degraded']),
    weatherService: z.enum(['up', 'degraded', 'down']),
  }),
})

export type StoreProviderKeyInput = z.infer<typeof storeProviderKeySchema>
export type ClearProviderKeyInput = z.infer<typeof clearProviderKeySchema>
