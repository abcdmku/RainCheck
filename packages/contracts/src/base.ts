import { z } from 'zod'

export const themeSchema = z.enum(['dark', 'light', 'system'])
export const unitSystemSchema = z.enum(['imperial', 'metric'])
export const answerModeSchema = z.enum(['single', 'compare', 'rank'])
export const candidateModeSchema = z.enum(['named', 'discovered', 'mixed'])
export const rankingObjectiveSchema = z.enum([
  'severe-favorability',
  'beach-day',
  'pleasant-weather',
])
export const answerToneSchema = z.enum(['casual', 'professional'])
export const timeDisplaySchema = z.enum(['user-local', 'dual', 'target-local'])
export const providerIdSchema = z.enum([
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
])
export const providerSchema = providerIdSchema
export const taskClassSchema = z.enum(['chat', 'research', 'vision'])
export const weatherWorkflowSchema = z.enum([
  'current-conditions',
  'forecast',
  'alerts',
  'aviation',
  'severe-weather',
  'fire-weather',
  'precipitation',
  'winter-weather',
  'medium-range',
  'hydrology',
  'radar',
  'satellite',
  'mrms',
  'short-range-model',
  'blend-analysis',
  'global-model',
  'tropical',
  'marine',
  'upper-air',
  'historical-climate',
  'storm-history',
  'radar-analysis',
  'research-brief',
  'general-weather',
  'weather-analysis',
])
export const weatherSourceStatusSchema = z.enum(['official', 'secondary'])
export const authRequirementSchema = z.enum(['none', 'optional', 'required'])
export const chaseGuidanceLevelSchema = z.enum([
  'analysis-only',
  'general-target',
  'exact-target',
  'full-route',
])
export const artifactKindSchema = z.enum([
  'report',
  'chart',
  'radar-loop',
  'satellite-loop',
  'summary',
])

export const latLonSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

export type Theme = z.infer<typeof themeSchema>
export type UnitSystem = z.infer<typeof unitSystemSchema>
export type AnswerMode = z.infer<typeof answerModeSchema>
export type CandidateMode = z.infer<typeof candidateModeSchema>
export type RankingObjective = z.infer<typeof rankingObjectiveSchema>
export type AnswerTone = z.infer<typeof answerToneSchema>
export type TimeDisplay = z.infer<typeof timeDisplaySchema>
export type ProviderId = z.infer<typeof providerIdSchema>
export type TaskClass = z.infer<typeof taskClassSchema>
export type WeatherWorkflow = z.infer<typeof weatherWorkflowSchema>
export type WeatherSourceStatus = z.infer<typeof weatherSourceStatusSchema>
export type AuthRequirement = z.infer<typeof authRequirementSchema>
export type ChaseGuidanceLevel = z.infer<typeof chaseGuidanceLevelSchema>
export type ArtifactKind = z.infer<typeof artifactKindSchema>
export type LatLon = z.infer<typeof latLonSchema>
