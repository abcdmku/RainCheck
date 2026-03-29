import { z } from 'zod'
import { providerIdSchema } from './base'
import { conversationSchema, messageRecordSchema } from './chat'
import {
  appSettingsSchema,
  type clearProviderConnectionSchema,
  providerConnectionStateSchema,
  updateAppSettingsSchema,
  type updateProviderConnectionSchema,
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

export const settingsPayloadSchema = appSettingsSchema.extend({
  providerConnections: z.array(providerConnectionStateSchema),
  availableProviders: z.array(providerIdSchema).default([]),
})

export const updateSettingsInputSchema = updateAppSettingsSchema
export const updateSettingsResponseSchema = z.object({
  settings: settingsPayloadSchema,
})

export type UpdateSettingsInput = z.infer<typeof updateSettingsInputSchema>
export type SettingsPayload = z.infer<typeof settingsPayloadSchema>

export const healthResponseSchema = z.object({
  ok: z.boolean(),
  version: z.string(),
  services: z.object({
    api: z.literal('up'),
    database: z.enum(['up', 'degraded']),
    weatherService: z.enum(['up', 'degraded', 'down']),
  }),
})

export const runtimeInfoSchema = z.object({
  runtimeId: z.string(),
  startedAt: z.string(),
  processId: z.number().int().nonnegative(),
  environment: z.enum(['development', 'test', 'production']),
  apiBaseUrl: z.string().url(),
  weatherServiceUrl: z.string().url(),
})

export type RuntimeInfo = z.infer<typeof runtimeInfoSchema>

export const runtimeInfoResponseSchema = z.object({
  runtime: runtimeInfoSchema,
})

export type UpdateProviderConnectionInput = z.infer<
  typeof updateProviderConnectionSchema
>
export type ClearProviderConnectionInput = z.infer<
  typeof clearProviderConnectionSchema
>
