import { z } from 'zod'

import {
  conversationSchema,
  messageRecordSchema,
  routeDecisionSchema,
} from './chat'
import {
  appSettingsSchema,
  type clearProviderKeySchema,
  type storeProviderKeySchema,
  updateAppSettingsSchema,
} from './settings'
import {
  alertSummarySchema,
  aviationSummarySchema,
  currentConditionsSchema,
  forecastSummarySchema,
  hydrologySummarySchema,
  modelComparisonSummarySchema,
  severeSummarySchema,
} from './weather'

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

export const weatherDigestResponseSchema = z.object({
  current: currentConditionsSchema.nullable(),
  forecast: forecastSummarySchema.nullable(),
  alerts: z.array(alertSummarySchema),
  aviation: aviationSummarySchema.nullable().optional(),
  severe: severeSummarySchema.nullable().optional(),
  hydrology: hydrologySummarySchema.nullable().optional(),
  modelComparison: modelComparisonSummarySchema.nullable().optional(),
  routing: routeDecisionSchema.optional(),
})

export type StoreProviderKeyInput = z.infer<typeof storeProviderKeySchema>
export type ClearProviderKeyInput = z.infer<typeof clearProviderKeySchema>
