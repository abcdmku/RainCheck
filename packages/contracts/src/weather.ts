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
  hazards: z.object({
    sigmets: z.array(z.string()).default([]),
    gAirmets: z.array(z.string()).default([]),
    cwas: z.array(z.string()).default([]),
    pireps: z.array(z.string()).default([]),
  }).default({
    sigmets: [],
    gAirmets: [],
    cwas: [],
    pireps: [],
  }),
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

export const weatherArtifactHandleSchema = z.object({
  artifactId: z.string(),
  type: z.string(),
  title: z.string(),
  href: z.string(),
  mimeType: z.string(),
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
    data: z.unknown(),
    citations: z.array(citationSchema),
    artifacts: z.array(weatherArtifactHandleSchema).optional(),
  })
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

export const modelComparisonEntrySchema = z.object({
  sourceId: z.string(),
  modelLabel: z.string(),
  runTime: z.string(),
  validTime: z.string(),
  summary: z.string(),
})

export const modelComparisonSummarySchema = z.object({
  locationName: z.string(),
  comparedModels: z.array(modelComparisonEntrySchema),
  consensus: z.string(),
  uncertainty: z.string(),
})
