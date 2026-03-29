import { z } from 'zod'

import {
  answerModeSchema,
  candidateModeSchema,
  chaseGuidanceLevelSchema,
  providerIdSchema,
  rankingObjectiveSchema,
  taskClassSchema,
  timeDisplaySchema,
  unitSystemSchema,
  weatherWorkflowSchema,
} from './base'

export const unitSchema = unitSystemSchema

export const locationContextSchema = z.object({
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  region: z.string().optional(),
  country: z.string().optional(),
  timezone: z.string().optional(),
  label: z.string().optional(),
})

const userProviderPreferenceSchema = z.object({
  enabled: z.boolean().default(false),
  provider: providerIdSchema,
  model: z.string(),
})

const userProviderSettingsSchema = z.object({
  defaultChat: userProviderPreferenceSchema.optional(),
  defaultResearch: userProviderPreferenceSchema.optional(),
  defaultVision: userProviderPreferenceSchema.optional(),
})

export const userSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  units: unitSchema.default('imperial'),
  timeDisplay: timeDisplaySchema.default('user-local'),
  defaultLocation: locationContextSchema.nullable().default(null),
  useBrowserLocation: z.boolean().default(false),
  providerPreferences: userProviderSettingsSchema.default({}),
  exportSharingEnabled: z.boolean().default(false),
})

export type UserSettings = z.infer<typeof userSettingsSchema>

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  pinned: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
  latestPreview: z.string().nullable().default(null),
})

export type Conversation = z.infer<typeof conversationSchema>

export const citationKindSchema = z.enum([
  'api',
  'page',
  'image',
  'dataset',
  'artifact',
  'derived',
])

export const citationSchema = z.object({
  id: z.string(),
  label: z.string(),
  sourceId: z.string(),
  productId: z.string(),
  kind: citationKindSchema.default('page'),
  url: z.string().url().optional(),
  contextUrl: z.string().url().optional(),
  displayUrl: z.string().optional(),
  issuedAt: z.string().optional(),
  validAt: z.string().optional(),
  note: z.string().optional(),
})

export type Citation = z.infer<typeof citationSchema>

export const artifactManifestSchema = z.object({
  id: z.string(),
  type: z.enum([
    'chart',
    'report',
    'radar-loop',
    'satellite-loop',
    'summary-card',
  ]),
  title: z.string(),
  description: z.string(),
  mimeType: z.string(),
  href: z.string(),
  createdAt: z.string(),
  sourceIds: z.array(z.string()).default([]),
})

export type ArtifactManifest = z.infer<typeof artifactManifestSchema>

export const messageRecordSchema = z.object({
  id: z.string(),
  conversationId: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
  citations: z.array(citationSchema).default([]),
  artifacts: z.array(artifactManifestSchema).default([]),
  createdAt: z.string(),
  model: z.string().nullable().default(null),
  provider: providerIdSchema.nullable().default(null),
  transport: z.enum(['api', 'local-cli']).nullable().default(null),
  source: z
    .enum(['shared-env', 'local-api-key', 'desktop-local-cli'])
    .nullable()
    .default(null),
})

export type MessageRecord = z.infer<typeof messageRecordSchema>

export const createConversationInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
})

export type CreateConversationInput = z.infer<
  typeof createConversationInputSchema
>

export const providerTransportSchema = z.enum(['api', 'local-cli'])

export const providerSourceSchema = z.enum([
  'shared-env',
  'local-api-key',
  'desktop-local-cli',
])

export const routeDecisionSchema = z.object({
  taskClass: taskClassSchema,
  provider: providerIdSchema,
  model: z.string(),
  reason: z.string(),
  transport: providerTransportSchema,
  source: providerSourceSchema,
  availableProviders: z.array(providerIdSchema),
})

export const requestClassificationSchema = z.object({
  taskClass: taskClassSchema,
  intent: weatherWorkflowSchema,
  timeHorizonHours: z.number().int().min(0).max(720),
  locationRequired: z.boolean(),
  needsArtifact: z.boolean(),
  chaseGuidanceLevel: chaseGuidanceLevelSchema.default('analysis-only'),
  answerMode: answerModeSchema.default('single'),
  candidateMode: candidateModeSchema.default('named'),
  rankLimit: z.number().int().min(1).max(12).default(1),
  rankingObjective: rankingObjectiveSchema.optional(),
})

export type RequestClassification = z.infer<typeof requestClassificationSchema>
export type ProviderTransport = z.infer<typeof providerTransportSchema>
export type ProviderSource = z.infer<typeof providerSourceSchema>
