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
  hazards: z
    .object({
      sigmets: z.array(z.string()).default([]),
      gAirmets: z.array(z.string()).default([]),
      cwas: z.array(z.string()).default([]),
      pireps: z.array(z.string()).default([]),
    })
    .default({
      sigmets: [],
      gAirmets: [],
      cwas: [],
      pireps: [],
    }),
  summary: z.string(),
  citations: z.array(citationSchema),
})

export const weatherArtifactHandleSchema = z.object({
  artifactId: z.string(),
  type: z.string(),
  title: z.string(),
  href: z.string(),
  mimeType: z.string(),
})

export const weatherPreviewFieldsSchema = z.object({
  thumbnailUrl: z.string().optional(),
  imageAlt: z.string().optional(),
  previewArtifactId: z.string().optional(),
  fullArtifactId: z.string().optional(),
  severity: z.string().optional(),
})

export const weatherValidityRangeSchema = z.object({
  start: z.string(),
  end: z.string(),
})

export const weatherUnitsSchema = z
  .object({
    temperature: z.string().optional(),
    windSpeed: z.string().optional(),
    windDirection: z.string().optional(),
    precipitation: z.string().optional(),
    visibility: z.string().optional(),
    pressure: z.string().optional(),
    height: z.string().optional(),
    waveHeight: z.string().optional(),
    flow: z.string().optional(),
    depth: z.string().optional(),
  })
  .catchall(z.string())
  .default({})

export const weatherProductCardSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceId: z.string(),
  sourceName: z.string(),
  summary: z.string(),
  url: z.string().optional(),
  imageUrl: z.string().optional(),
  imageAlt: z.string().optional(),
  artifactId: z.string().optional(),
  href: z.string().optional(),
  mimeType: z.string().optional(),
  relevance: z.enum(['primary', 'supporting']).default('supporting'),
  validAt: z.string().optional(),
  validRange: weatherValidityRangeSchema.optional(),
})

export const normalizedForecastSignalSchema = z.object({
  category: z
    .enum([
      'observation',
      'official',
      'analysis',
      'guidance',
      'hazard',
      'hydrology',
      'aviation',
      'pattern',
      'uncertainty',
      'general',
    ])
    .default('general'),
  weight: z.enum(['low', 'medium', 'high']).default('medium'),
  label: z.string(),
  detail: z.string(),
  sourceIds: z.array(z.string()).default([]),
  productIds: z.array(z.string()).default([]),
})

export const normalizedForecastObjectSchema = z.object({
  domain: z.string(),
  headline: z.string(),
  mostLikelyScenario: z.string().optional(),
  alternateScenarios: z.array(z.string()).default([]),
  likelihood: z.enum(['low', 'medium', 'high']).optional(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  keySignals: z.array(normalizedForecastSignalSchema).default([]),
  conflicts: z.array(z.string()).default([]),
  failureModes: z.array(z.string()).default([]),
  whatWouldChange: z.array(z.string()).default([]),
  productCards: z.array(weatherProductCardSchema).default([]),
  recommendedProductIds: z.array(z.string()).default([]),
})

export const weatherConfidenceSchema = z.object({
  level: z.enum(['low', 'medium', 'high']),
  reason: z.string(),
})

export const weatherConclusionSchema = z.object({
  bottomLine: z.string(),
  confidence: weatherConfidenceSchema,
  mostLikelyScenario: z.string(),
  alternateScenarios: z.array(z.string()).default([]),
  keySignals: z.array(z.string()).default([]),
  conflicts: z.array(z.string()).default([]),
  whatWouldChangeTheForecast: z.array(z.string()).default([]),
  recommendedArtifacts: z.array(z.string()).default([]),
  productCards: z.array(weatherProductCardSchema).default([]),
  citations: z.array(citationSchema).default([]),
  artifacts: z.array(weatherArtifactHandleSchema).default([]),
})

export const weatherToolEnvelopeSchema = z
  .object({
    sourceId: z.string(),
    sourceName: z.string(),
    retrievedAt: z.string(),
    validAt: z.string().optional(),
    validRange: weatherValidityRangeSchema.optional(),
    location: normalizedLocationSchema,
    units: weatherUnitsSchema,
    confidence: z.number().min(0).max(1),
    summary: z.string(),
    normalizedForecast: normalizedForecastObjectSchema,
    data: z.unknown(),
    citations: z.array(citationSchema),
    artifacts: z.array(weatherArtifactHandleSchema).optional(),
  })
  .merge(weatherPreviewFieldsSchema)
  .refine(
    (value) => value.validAt !== undefined || value.validRange !== undefined,
    {
      message: 'weather tool responses must include validAt or validRange',
      path: ['validAt'],
    },
  )

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
