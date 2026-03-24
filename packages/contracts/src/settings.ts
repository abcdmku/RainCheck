import { z } from 'zod'
import {
  providerIdSchema,
  taskClassSchema,
  themeSchema,
  unitSystemSchema,
} from './base'

export const providerPreferenceSchema = z.object({
  taskClass: taskClassSchema,
  providerId: providerIdSchema,
  model: z.string().min(1),
})

export const byokStateSchema = z.object({
  providerId: providerIdSchema,
  configured: z.boolean(),
  useByok: z.boolean(),
  updatedAt: z.string().nullable(),
})

export const appSettingsSchema = z.object({
  theme: themeSchema,
  units: unitSystemSchema,
  defaultLocationLabel: z.string().nullable(),
  allowDeviceLocation: z.boolean(),
  providerPreferences: z.array(providerPreferenceSchema),
  byok: z.array(byokStateSchema),
  shareByDefault: z.boolean(),
})

export const updateAppSettingsSchema = appSettingsSchema.partial().extend({
  providerPreferences: providerPreferenceSchema.array().optional(),
  byok: byokStateSchema.array().optional(),
})

export const storeProviderKeySchema = z.object({
  providerId: providerIdSchema,
  apiKey: z.string().min(1),
  useByok: z.boolean().default(true),
})

export const clearProviderKeySchema = z.object({
  providerId: providerIdSchema,
})

export type ProviderPreference = z.infer<typeof providerPreferenceSchema>
export type ByokState = z.infer<typeof byokStateSchema>
export type AppSettings = z.infer<typeof appSettingsSchema>
export type UpdateAppSettings = z.infer<typeof updateAppSettingsSchema>
export type StoreProviderKey = z.infer<typeof storeProviderKeySchema>
