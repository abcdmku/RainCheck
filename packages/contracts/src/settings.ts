import { z } from 'zod'
import {
  answerToneSchema,
  providerIdSchema,
  taskClassSchema,
  themeSchema,
  timeDisplaySchema,
  unitSystemSchema,
} from './base'

export const providerPreferenceSchema = z.object({
  taskClass: taskClassSchema,
  providerId: providerIdSchema,
  model: z.string().min(1),
})

export const storedProviderConnectionModeSchema = z.enum(['api-key'])

export const localCliProviderIdSchema = z.enum(['openai', 'anthropic'])

export const providerConnectionModeSchema = z.enum(['none', 'env', 'api-key'])

export const localCliCommandSchema = z.enum(['codex', 'claude'])

export const localCliDiagnosticsSchema = z.object({
  command: localCliCommandSchema,
  detected: z.boolean(),
  authReady: z.boolean(),
  authMethod: z.string().nullable(),
  subscriptionType: z.string().nullable(),
  statusLabel: z.string(),
})

export const providerConnectionStateSchema = z.object({
  providerId: providerIdSchema,
  mode: providerConnectionModeSchema,
  configured: z.boolean(),
  available: z.boolean(),
  model: z.string().nullable(),
  updatedAt: z.string().nullable(),
  localCli: localCliDiagnosticsSchema.nullable().default(null),
})

export const appSettingsSchema = z.object({
  theme: themeSchema,
  units: unitSystemSchema,
  answerTone: answerToneSchema.default('casual'),
  timeDisplay: timeDisplaySchema.default('user-local'),
  defaultLocationLabel: z.string().nullable(),
  allowDeviceLocation: z.boolean(),
  providerPreferences: z.array(providerPreferenceSchema),
  shareByDefault: z.boolean(),
})

export const updateAppSettingsSchema = appSettingsSchema.partial().extend({
  providerPreferences: providerPreferenceSchema.array().optional(),
})

export const updateProviderConnectionSchema = z.object({
  providerId: providerIdSchema,
  mode: z.literal('api-key'),
  apiKey: z.string().min(1),
})

export const clearProviderConnectionSchema = z.object({
  providerId: providerIdSchema,
})

export type ProviderPreference = z.infer<typeof providerPreferenceSchema>
export type StoredProviderConnectionMode = z.infer<
  typeof storedProviderConnectionModeSchema
>
export type ProviderConnectionMode = z.infer<
  typeof providerConnectionModeSchema
>
export type LocalCliDiagnostics = z.infer<typeof localCliDiagnosticsSchema>
export type ProviderConnectionState = z.infer<
  typeof providerConnectionStateSchema
>
export type AppSettings = z.infer<typeof appSettingsSchema>
export type UpdateAppSettings = z.infer<typeof updateAppSettingsSchema>
export type UpdateProviderConnection = z.infer<
  typeof updateProviderConnectionSchema
>
export type ClearProviderConnection = z.infer<
  typeof clearProviderConnectionSchema
>
