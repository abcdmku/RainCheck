import { z } from 'zod'

import { citationSchema } from './chat'

export const normalizedLocationSchema = z.object({
  query: z.string(),
  name: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  region: z.string().optional(),
  country: z.string().optional(),
  resolvedBy: z.string(),
})

export const currentConditionsSchema = z.object({
  location: normalizedLocationSchema,
  temperature: z.object({
    value: z.number(),
    unit: z.enum(['F', 'C']),
  }),
  wind: z.object({
    speed: z.number().nullable(),
    direction: z.string().nullable(),
  }),
  humidityPercent: z.number().nullable(),
  textDescription: z.string(),
  observedAt: z.string(),
  source: citationSchema,
})

export const forecastPeriodSchema = z.object({
  name: z.string(),
  startTime: z.string(),
  endTime: z.string(),
  temperature: z.number(),
  temperatureUnit: z.enum(['F', 'C']),
  wind: z.string(),
  shortForecast: z.string(),
  detailedForecast: z.string(),
})

export const forecastSummarySchema = z.object({
  location: normalizedLocationSchema,
  generatedAt: z.string(),
  periods: z.array(forecastPeriodSchema),
  source: citationSchema,
})

export const alertSummarySchema = z.object({
  id: z.string(),
  headline: z.string(),
  severity: z.string(),
  certainty: z.string().nullable(),
  urgency: z.string().nullable(),
  effective: z.string().nullable(),
  expires: z.string().nullable(),
  area: z.string(),
  description: z.string(),
  instruction: z.string().nullable(),
  source: citationSchema,
})

export const aviationSummarySchema = z.object({
  stationId: z.string(),
  metar: z.string().nullable(),
  taf: z.string().nullable(),
  summary: z.string(),
  citations: z.array(citationSchema),
})

export const severeSummarySchema = z.object({
  area: z.string(),
  summary: z.string(),
  outlookCategory: z.string().nullable(),
  watchContext: z.string().nullable(),
  citations: z.array(citationSchema),
})

export const hydrologySummarySchema = z.object({
  gaugeName: z.string(),
  summary: z.string(),
  floodCategory: z.string().nullable(),
  observedAt: z.string().nullable(),
  citations: z.array(citationSchema),
})

export const sourceManifestSchema = z.object({
  sourceId: z.string(),
  productId: z.string(),
  rank: z.number().int().positive(),
  reason: z.string(),
})

export const citationBundleSchema = z.object({
  citations: z.array(citationSchema),
  manifests: z.array(sourceManifestSchema),
})

export const reportOutlineSchema = z.object({
  title: z.string(),
  sections: z.array(
    z.object({
      heading: z.string(),
      summary: z.string(),
    }),
  ),
})

export const modelComparisonSummarySchema = z.object({
  locationName: z.string(),
  comparedModels: z.array(
    z.object({
      sourceId: z.string(),
      modelLabel: z.string(),
      runTime: z.string(),
      validTime: z.string(),
      summary: z.string(),
    }),
  ),
  consensus: z.string(),
  uncertainty: z.string(),
})
