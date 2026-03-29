import { z } from 'zod'
import {
  answerToneSchema,
  providerIdSchema,
  timeDisplaySchema,
  unitSystemSchema,
} from './base'
import {
  artifactManifestSchema,
  citationSchema,
  messageRecordSchema,
  requestClassificationSchema,
} from './chat'
import { localCliDiagnosticsSchema } from './settings'

export const desktopLocalCliProviderIdSchema = z.enum(['openai', 'anthropic'])

export const desktopLocationOverrideSchema = z.object({
  label: z.string().trim().min(1),
  name: z.string().trim().min(1).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  region: z.string().trim().min(1).optional(),
  country: z.string().trim().min(1).optional(),
  timezone: z.string().trim().min(1).optional(),
  source: z.enum(['saved', 'device', 'message', 'manual']).optional(),
})

export const weatherAnswerContextSnapshotSchema = z.object({
  location: desktopLocationOverrideSchema.nullable(),
  units: unitSystemSchema,
  timeDisplay: timeDisplaySchema,
  answerTone: answerToneSchema,
  displayTimezone: z.string().trim().min(1).optional(),
})

export const desktopLocalCliConnectionInputSchema = z.object({
  providerId: desktopLocalCliProviderIdSchema,
  model: z.string().trim().min(1),
})

export const desktopLocalCliConnectionStateSchema = z.object({
  providerId: desktopLocalCliProviderIdSchema,
  connected: z.boolean(),
  configured: z.boolean(),
  model: z.string().nullable(),
  updatedAt: z.string().nullable(),
  localCli: localCliDiagnosticsSchema,
})

export const desktopProviderConnectionsResponseSchema = z.object({
  providers: z.array(desktopLocalCliConnectionStateSchema),
})

export const desktopLocalCliSessionRequestSchema = z.object({
  apiBaseUrl: z.string().url(),
  conversationId: z.string(),
  message: z.string().trim().min(1),
  clientMessageId: z.string().trim().min(1).optional(),
  providerId: desktopLocalCliProviderIdSchema,
  model: z.string().trim().min(1),
  route: z.object({
    transport: z.literal('local-cli'),
    source: z.literal('desktop-local-cli'),
  }),
  context: weatherAnswerContextSnapshotSchema,
})

export const desktopLocalCliToolCatalogItemSchema = z.object({
  name: z.string(),
  description: z.string(),
  inputSchema: z.record(z.string(), z.unknown()),
})

export const desktopLocalCliToolCallSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
})

export const desktopLocalCliToolResultSchema = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  result: z.unknown(),
})

export const desktopLocalCliProgressEventSchema = z.object({
  type: z.enum(['status', 'tool-call', 'tool-result']),
  label: z.string(),
  toolCall: desktopLocalCliToolCallSchema.optional(),
  toolResult: desktopLocalCliToolResultSchema.optional(),
})

export const desktopLocalCliPreparedSessionSchema = z.object({
  conversationId: z.string(),
  userMessageId: z.string(),
  providerId: desktopLocalCliProviderIdSchema,
  model: z.string(),
  route: z.object({
    provider: providerIdSchema,
    model: z.string(),
    transport: z.literal('local-cli'),
    source: z.literal('desktop-local-cli'),
  }),
  classification: requestClassificationSchema,
  systemPrompt: z.string(),
  messages: z.array(messageRecordSchema),
  toolCatalog: z.array(desktopLocalCliToolCatalogItemSchema),
  answerContext: weatherAnswerContextSnapshotSchema,
})

export const desktopLocalCliPrepareInputSchema =
  desktopLocalCliSessionRequestSchema

export const desktopLocalCliPrepareResponseSchema = z.object({
  session: desktopLocalCliPreparedSessionSchema,
})

export const desktopLocalCliExecuteToolsInputSchema = z.object({
  session: desktopLocalCliPreparedSessionSchema,
  toolCalls: z.array(desktopLocalCliToolCallSchema).max(12),
})

export const desktopLocalCliExecuteToolsResponseSchema = z.object({
  progressEvents: z.array(desktopLocalCliProgressEventSchema).default([]),
  results: z.array(desktopLocalCliToolResultSchema),
})

export const desktopLocalCliCompleteInputSchema = z.object({
  session: desktopLocalCliPreparedSessionSchema,
  responseText: z.string().trim().min(1),
  toolResults: z.array(desktopLocalCliToolResultSchema).default([]),
})

export const desktopLocalCliCompleteResponseSchema = z.object({
  message: messageRecordSchema,
  citations: z.array(citationSchema),
  artifacts: z.array(artifactManifestSchema),
})

export const desktopLocalCliChatRequestSchema =
  desktopLocalCliSessionRequestSchema

export const desktopLocalCliRunResultSchema = z.object({
  message: messageRecordSchema,
  citations: z.array(citationSchema),
  artifacts: z.array(artifactManifestSchema),
})

export type DesktopLocalCliProviderId = z.infer<
  typeof desktopLocalCliProviderIdSchema
>
export type DesktopLocationOverride = z.infer<
  typeof desktopLocationOverrideSchema
>
export type WeatherAnswerContextSnapshot = z.infer<
  typeof weatherAnswerContextSnapshotSchema
>
export type DesktopLocalCliConnectionInput = z.infer<
  typeof desktopLocalCliConnectionInputSchema
>
export type DesktopLocalCliConnectionState = z.infer<
  typeof desktopLocalCliConnectionStateSchema
>
export type DesktopProviderConnectionsResponse = z.infer<
  typeof desktopProviderConnectionsResponseSchema
>
export type DesktopLocalCliSessionRequest = z.infer<
  typeof desktopLocalCliSessionRequestSchema
>
export type DesktopLocalCliToolCatalogItem = z.infer<
  typeof desktopLocalCliToolCatalogItemSchema
>
export type DesktopLocalCliToolCall = z.infer<
  typeof desktopLocalCliToolCallSchema
>
export type DesktopLocalCliToolResult = z.infer<
  typeof desktopLocalCliToolResultSchema
>
export type DesktopLocalCliPreparedSession = z.infer<
  typeof desktopLocalCliPreparedSessionSchema
>
export type DesktopLocalCliPrepareInput = z.infer<
  typeof desktopLocalCliPrepareInputSchema
>
export type DesktopLocalCliPrepareResponse = z.infer<
  typeof desktopLocalCliPrepareResponseSchema
>
export type DesktopLocalCliExecuteToolsInput = z.infer<
  typeof desktopLocalCliExecuteToolsInputSchema
>
export type DesktopLocalCliExecuteToolsResponse = z.infer<
  typeof desktopLocalCliExecuteToolsResponseSchema
>
export type DesktopLocalCliCompleteInput = z.infer<
  typeof desktopLocalCliCompleteInputSchema
>
export type DesktopLocalCliCompleteResponse = z.infer<
  typeof desktopLocalCliCompleteResponseSchema
>
export type DesktopLocalCliChatRequest = z.infer<
  typeof desktopLocalCliChatRequestSchema
>
export type DesktopLocalCliRunResult = z.infer<
  typeof desktopLocalCliRunResultSchema
>
export type DesktopLocalCliProgressEvent = z.infer<
  typeof desktopLocalCliProgressEventSchema
>
