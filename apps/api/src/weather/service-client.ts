import {
  weatherComparisonBundleSchema,
  weatherComparisonRequestSchema,
  derivationBundleSchema,
  deriveGlobalRequestSchema,
  deriveHydrologyRequestSchema,
  deriveRadarNowcastRequestSchema,
  deriveSatelliteRequestSchema,
  deriveShortRangeRequestSchema,
  forecastSummarySchema,
  synthesisBundleSchema,
} from '@raincheck/contracts'
import { AppError } from '../lib/errors'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import { getForecast } from './nws'

type BaseArtifactType =
  | 'meteogram'
  | 'research-report'
  | 'radar-loop'
  | 'satellite-loop'
  | 'hydrograph'
  | 'skewt'
  | 'rainfall-chart'
  | 'snowfall-chart'
  | 'brief-report'
  | 'single-model-panel'
  | 'hodograph'
  | 'time-height-chart'

type ArtifactChartPoint = {
  label: string
  value: number
}

type ArtifactChartSeries = {
  label: string
  points: Array<ArtifactChartPoint>
  color?: string
}

type ArtifactLoopFrame = {
  label: string
  timestamp?: string
  description?: string
  imageUrl?: string
}

type ArtifactSoundingLevel = {
  pressureHpa: number
  temperatureC?: number
  dewpointC?: number
  windSpeedKt?: number
  windDirectionDeg?: number
}

type ArtifactOptions = {
  artifactType: BaseArtifactType
  locationQuery: string
  prompt: string
  chartPoints?: Array<ArtifactChartPoint>
  chartSeries?: Array<ArtifactChartSeries>
  frames?: Array<ArtifactLoopFrame>
  soundingLevels?: Array<ArtifactSoundingLevel>
  thresholds?: Array<ArtifactChartPoint>
  sections?: Array<string>
}

function resolveServiceUrl(app: FastifyInstance, path: string) {
  return `${app.raincheckEnv.WEATHER_SERVICE_URL}${path}`
}

function normalizeWeatherServiceError(
  path: string,
  response: Response,
  bodyText?: string,
) {
  return new AppError(
    502,
    'weather_service_request_failed',
    `Weather service request to ${path} failed with status ${response.status}.`,
    {
      path,
      status: response.status,
      statusText: response.statusText,
      bodyText,
    },
  )
}

function stripNullValues<T>(value: T): T {
  if (value == null) {
    return undefined as T
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => stripNullValues(item))
      .filter((item) => item !== undefined) as T
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, stripNullValues(item)] as const)
      .filter(([, item]) => item !== undefined)

    return Object.fromEntries(entries) as T
  }

  return value
}

async function postWeatherServiceJson<TSchema extends z.ZodTypeAny>(
  app: FastifyInstance,
  path: string,
  body: unknown,
  schema: TSchema,
): Promise<z.infer<TSchema>> {
  const response = await fetch(resolveServiceUrl(app, path), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw normalizeWeatherServiceError(path, response, bodyText)
  }

  const payload = stripNullValues((await response.json()) as unknown)
  return schema.parse(payload)
}

export async function checkWeatherService(app: FastifyInstance) {
  try {
    const response = await fetch(
      resolveServiceUrl(app, '/health'),
    )
    return response.ok
  } catch {
    return false
  }
}

async function loadMeteogramForecast(
  app: FastifyInstance,
  locationQuery: string,
) {
  return forecastSummarySchema.parse(
    await getForecast(app, locationQuery, 'short'),
  )
}

function buildMeteogramChartPoints(
  forecast: Awaited<ReturnType<typeof loadMeteogramForecast>>,
) {
  return forecast.periods.slice(0, 6).map((period) => ({
    label: period.name,
    value: period.temperature,
  }))
}

function resolveChartPoints(
  options: ArtifactOptions,
  forecast: Awaited<ReturnType<typeof loadMeteogramForecast>>,
) {
  return options.chartPoints?.length
    ? options.chartPoints
    : buildMeteogramChartPoints(forecast)
}

export async function deriveShortRangeWeather(
  app: FastifyInstance,
  request: z.input<typeof deriveShortRangeRequestSchema>,
) {
  return postWeatherServiceJson(
    app,
    '/derive/short-range',
    request,
    derivationBundleSchema,
  )
}

export async function deriveGlobalWeather(
  app: FastifyInstance,
  request: z.input<typeof deriveGlobalRequestSchema>,
) {
  return postWeatherServiceJson(
    app,
    '/derive/global',
    request,
    derivationBundleSchema,
  )
}

export async function deriveRadarNowcast(
  app: FastifyInstance,
  request: z.input<typeof deriveRadarNowcastRequestSchema>,
) {
  return postWeatherServiceJson(
    app,
    '/derive/radar-nowcast',
    request,
    derivationBundleSchema,
  )
}

export async function deriveSatelliteWeather(
  app: FastifyInstance,
  request: z.input<typeof deriveSatelliteRequestSchema>,
) {
  return postWeatherServiceJson(
    app,
    '/derive/satellite',
    request,
    derivationBundleSchema,
  )
}

export async function deriveHydrologyWeather(
  app: FastifyInstance,
  request: z.input<typeof deriveHydrologyRequestSchema>,
) {
  return postWeatherServiceJson(
    app,
    '/derive/hydrology',
    request,
    derivationBundleSchema,
  )
}

export async function synthesizeWeatherConclusion(
  app: FastifyInstance,
  request: unknown,
) {
  return postWeatherServiceJson(
    app,
    '/synthesize',
    request,
    synthesisBundleSchema,
  )
}

export async function compareWeatherCandidates(
  app: FastifyInstance,
  request: z.input<typeof weatherComparisonRequestSchema>,
) {
  return postWeatherServiceJson(
    app,
    '/compare',
    request,
    weatherComparisonBundleSchema,
  )
}

export async function generateArtifact(
  app: FastifyInstance,
  options: ArtifactOptions,
) {
  const meteogramForecast =
    options.artifactType === 'meteogram' ||
    options.artifactType === 'rainfall-chart' ||
    options.artifactType === 'snowfall-chart' ||
    options.artifactType === 'hydrograph'
      ? await loadMeteogramForecast(app, options.locationQuery)
      : null

  const requestBody =
    options.artifactType === 'meteogram' && meteogramForecast
      ? {
          artifactType: 'meteogram' as const,
          prompt: options.prompt,
          location: {
            latitude: meteogramForecast.location.latitude,
            longitude: meteogramForecast.location.longitude,
            name: meteogramForecast.location.name,
          },
          chartPoints: resolveChartPoints(options, meteogramForecast),
        }
      : options

  const response = await fetch(
    resolveServiceUrl(app, `/artifacts/${options.artifactType}`),
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    },
  )

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '')
    throw normalizeWeatherServiceError(
      `/artifacts/${options.artifactType}`,
      response,
      bodyText,
    )
  }

  const data = (await response.json()) as {
    artifactId: string
    type?: string
    artifactType?: string
    title: string
    href: string
    mimeType: string
  }

  return {
    ...data,
    type: data.type ?? data.artifactType ?? options.artifactType,
  }
}
