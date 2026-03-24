import { z } from 'zod'

export const themeSchema = z.enum(['dark', 'light', 'system'])
export const unitSystemSchema = z.enum(['imperial', 'metric'])
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
  'model-comparison',
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
export const artifactKindSchema = z.enum([
  'report',
  'chart',
  'radar-loop',
  'satellite-loop',
  'model-comparison',
  'summary',
])

export const latLonSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
})

export type Theme = z.infer<typeof themeSchema>
export type UnitSystem = z.infer<typeof unitSystemSchema>
export type ProviderId = z.infer<typeof providerIdSchema>
export type TaskClass = z.infer<typeof taskClassSchema>
export type WeatherWorkflow = z.infer<typeof weatherWorkflowSchema>
export type WeatherSourceStatus = z.infer<typeof weatherSourceStatusSchema>
export type AuthRequirement = z.infer<typeof authRequirementSchema>
export type ArtifactKind = z.infer<typeof artifactKindSchema>
export type LatLon = z.infer<typeof latLonSchema>
