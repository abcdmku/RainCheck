import {
  generateWeatherArtifactToolDef,
  getAlertsToolDef,
  getAviationContextToolDef,
  getCurrentConditionsToolDef,
  getFireWeatherProductsToolDef,
  getForecastToolDef,
  getGlobalGuidanceToolDef,
  getHistoricalClimateToolDef,
  getMarineOceanGuidanceToolDef,
  getPrecipFloodContextToolDef,
  getRadarSatelliteNowcastToolDef,
  getSevereContextToolDef,
  getShortRangeGuidanceToolDef,
  getStormHistoryToolDef,
  getTropicalWeatherToolDef,
  getUpperAirSoundingsToolDef,
  getWpcMediumRangeHazardsToolDef,
  getWpcWinterWeatherToolDef,
  type RequestClassification,
  resolveLocationToolDef,
  synthesizeWeatherConclusionToolDef,
} from '@raincheck/contracts'
import type { ServerTool } from '@tanstack/ai'
import type { FastifyInstance } from 'fastify'
import { getHistoricalClimate, getStormHistory } from '../weather/climate'
import {
  getAviationContext,
  getPrecipFloodContext,
  getRadarSatelliteNowcast,
  getSevereContext,
} from '../weather/domain-tools'
import { getFireWeatherProducts } from '../weather/fire-weather'
import { geocodeQuery } from '../weather/geocode'
import { getMarineOceanGuidance } from '../weather/marine'
import { getGlobalGuidance, getShortRangeGuidance } from '../weather/models'
import { getAlerts, getCurrentConditions, getForecast } from '../weather/nws'
import { buildWeatherEnvelope, type WeatherSignal } from '../weather/runtime'
import { generateArtifact } from '../weather/service-client'
import { synthesizeWeatherConclusion } from '../weather/synthesis'
import {
  formatIsoLocalTimeRange,
  normalizeTimingLanguage,
} from '../weather/timing-language'
import { getTropicalWeather } from '../weather/tropical'
import { getUpperAirSoundings } from '../weather/upper-air'
import { getWpcMediumRangeHazards, getWpcWinterWeather } from '../weather/wpc'

function withProgress<TArgs, TResult>(
  label: string,
  handler: (args: TArgs) => Promise<TResult>,
) {
  return async (
    args: TArgs,
    context?: {
      emitCustomEvent?: (name: string, value: Record<string, unknown>) => void
    },
  ) => {
    context?.emitCustomEvent?.('tool-progress', {
      label,
    })
    return handler(args)
  }
}

function nowIso() {
  return new Date().toISOString()
}

function confidenceLevel(value: number): 'low' | 'medium' | 'high' {
  if (value >= 0.8) {
    return 'high'
  }

  if (value >= 0.6) {
    return 'medium'
  }

  return 'low'
}

function buildToolSet(
  coreTools: Array<ServerTool<any, any>>,
  extraTools: Array<ServerTool<any, any>>,
) {
  return [...new Set([...coreTools, ...extraTools])]
}

function wrapCurrentConditions(
  result: Awaited<ReturnType<typeof getCurrentConditions>>,
) {
  const temp = `${result.temperature.value}${result.temperature.unit}`
  const wind =
    result.wind.speed != null
      ? `Wind ${result.wind.speed} mph${result.wind.direction ? ` ${result.wind.direction}` : ''}.`
      : 'Wind data unavailable.'
  const confidence = 0.94
  const summary = `${result.textDescription} around ${temp}. ${wind}`.trim()

  return buildWeatherEnvelope({
    source: {
      sourceId: result.source.sourceId,
      productId: result.source.productId,
      label: result.source.label,
      url: result.source.url ?? 'https://api.weather.gov/',
    },
    location: result.location,
    units: {
      temperature: result.temperature.unit,
      windSpeed: 'mph',
      humidityPercent: '%',
    },
    validAt: result.observedAt,
    confidence,
    summary,
    normalizedForecast: {
      domain: 'current-conditions',
      headline: `Current observations show ${summary}`,
      mostLikelyScenario: summary,
      alternateScenarios: [],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals: [
        {
          category: 'observation',
          weight: 'high',
          label: 'Latest observation',
          detail: summary,
          sourceIds: [result.source.sourceId],
          productIds: [result.source.productId],
        } satisfies WeatherSignal,
      ],
      conflicts: [],
      failureModes: [],
      whatWouldChange: [],
      productCards: [],
      recommendedProductIds: [],
    },
    data: {
      current: result,
    },
    citations: [result.source],
  })
}

function wrapForecast(result: Awaited<ReturnType<typeof getForecast>>) {
  const first = result.periods[0]
  const last = result.periods.at(-1)
  const timingLabel =
    first != null
      ? formatIsoLocalTimeRange(first.startTime, first.endTime, {
          includeDay: true,
        })
      : null
  const summary = first
    ? `${timingLabel ?? normalizeTimingLanguage(first.name)}: ${normalizeTimingLanguage(first.shortForecast)}, near ${first.temperature}${first.temperatureUnit}.`
    : `Forecast context for ${result.location.name}.`
  const confidence = 0.9

  return buildWeatherEnvelope({
    source: {
      sourceId: result.source.sourceId,
      productId: result.source.productId,
      label: result.source.label,
      url: result.source.url ?? 'https://api.weather.gov/',
    },
    location: result.location,
    units: {
      temperature: first?.temperatureUnit ?? 'F',
      wind: 'mph',
    },
    validRange:
      first && last
        ? {
            start: first.startTime,
            end: last.endTime,
          }
        : undefined,
    confidence,
    summary,
    normalizedForecast: {
      domain: 'forecast',
      headline: `The official forecast for ${result.location.name} currently leads with: ${summary}`,
      mostLikelyScenario: normalizeTimingLanguage(
        first?.detailedForecast ?? first?.shortForecast ?? summary,
      ),
      alternateScenarios: [],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals: [
        {
          category: 'official',
          weight: 'high',
          label: 'Official forecast',
          detail: summary,
          sourceIds: [result.source.sourceId],
          productIds: [result.source.productId],
        } satisfies WeatherSignal,
      ],
      conflicts: [],
      failureModes: [],
      whatWouldChange: [],
      productCards: [],
      recommendedProductIds: [],
    },
    data: {
      generatedAt: result.generatedAt,
      periods: result.periods,
    },
    citations: [result.source],
  })
}

function wrapAlerts(
  result: Awaited<ReturnType<typeof getAlerts>>,
  location: Awaited<ReturnType<typeof geocodeQuery>>,
) {
  const firstAlert = result[0]
  const alertWindow =
    firstAlert?.effective && firstAlert.expires
      ? formatIsoLocalTimeRange(firstAlert.effective, firstAlert.expires, {
          includeDay: true,
        })
      : null
  const summary =
    firstAlert != null
      ? `${result.length} active alert${result.length === 1 ? '' : 's'} for ${location.name}. Most urgent: ${firstAlert.headline}${alertWindow ? ` from ${alertWindow}` : ''}.`
      : `No active alerts for ${location.name} at fetch time.`

  const validRange =
    firstAlert?.effective && firstAlert.expires
      ? {
          start: firstAlert.effective,
          end: firstAlert.expires,
        }
      : undefined
  const confidence = 0.96

  return buildWeatherEnvelope({
    source: {
      sourceId: 'weather-gov',
      productId: 'alerts',
      label: 'NWS active alerts',
      url: firstAlert?.source.url ?? 'https://api.weather.gov/alerts/active',
    },
    location,
    units: {
      severity: 'categorical',
    },
    validRange,
    validAt: validRange?.start ?? nowIso(),
    confidence,
    summary,
    normalizedForecast: {
      domain: 'alerts',
      headline: summary,
      mostLikelyScenario: summary,
      alternateScenarios: [],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals:
        firstAlert != null
          ? [
              {
                category: 'hazard',
                weight: 'high',
                label: firstAlert.headline,
                detail: firstAlert.description,
                sourceIds: ['weather-gov'],
                productIds: ['alerts'],
              } satisfies WeatherSignal,
            ]
          : [],
      conflicts: [],
      failureModes: [],
      whatWouldChange: [],
      productCards: [],
      recommendedProductIds: [],
    },
    data: {
      alerts: result,
    },
    citations: result.map((alert) => alert.source),
  })
}

export function buildServerTools(
  app: FastifyInstance,
  classification: RequestClassification,
) {
  const resolveLocation = resolveLocationToolDef.server(
    withProgress('Resolving location', ({ locationQuery }) =>
      geocodeQuery(app, locationQuery),
    ),
  )
  const currentConditions = getCurrentConditionsToolDef.server(
    withProgress('Fetching current conditions', async ({ locationQuery }) =>
      wrapCurrentConditions(await getCurrentConditions(app, locationQuery)),
    ),
  )
  const forecast = getForecastToolDef.server(
    withProgress('Fetching forecast', async ({ locationQuery, horizon }) =>
      wrapForecast(await getForecast(app, locationQuery, horizon)),
    ),
  )
  const alerts = getAlertsToolDef.server(
    withProgress('Fetching alerts', async ({ locationQuery }) => {
      const location = await geocodeQuery(app, locationQuery)
      return wrapAlerts(await getAlerts(app, locationQuery), location)
    }),
  )
  const shortRangeGuidance = getShortRangeGuidanceToolDef.server(
    withProgress('Fetching short-range guidance', ({ locationQuery }) =>
      getShortRangeGuidance(app, locationQuery),
    ),
  )
  const globalGuidance = getGlobalGuidanceToolDef.server(
    withProgress('Fetching global guidance', ({ locationQuery }) =>
      getGlobalGuidance(app, locationQuery ?? 'United States'),
    ),
  )
  const severeContext = getSevereContextToolDef.server(
    withProgress('Fetching severe context', ({ locationQuery }) =>
      getSevereContext(app, locationQuery ?? 'United States'),
    ),
  )
  const precipFloodContext = getPrecipFloodContextToolDef.server(
    withProgress(
      'Fetching precipitation and flood context',
      ({ locationQuery }) => getPrecipFloodContext(app, locationQuery),
    ),
  )
  const radarSatelliteNowcast = getRadarSatelliteNowcastToolDef.server(
    withProgress(
      'Fetching radar, satellite, and nowcast context',
      ({ locationQuery }) => getRadarSatelliteNowcast(app, locationQuery),
    ),
  )
  const aviationContext = getAviationContextToolDef.server(
    withProgress('Fetching aviation context', ({ stationId }) =>
      getAviationContext(app, stationId),
    ),
  )
  const fireWeather = getFireWeatherProductsToolDef.server(
    withProgress('Fetching fire-weather outlooks', ({ locationQuery }) =>
      getFireWeatherProducts(app, locationQuery),
    ),
  )
  const wpcWinter = getWpcWinterWeatherToolDef.server(
    withProgress('Fetching winter weather guidance', ({ locationQuery }) =>
      getWpcWinterWeather(app, locationQuery),
    ),
  )
  const wpcMedium = getWpcMediumRangeHazardsToolDef.server(
    withProgress('Fetching medium-range hazards', ({ locationQuery }) =>
      getWpcMediumRangeHazards(app, locationQuery ?? 'United States'),
    ),
  )
  const tropical = getTropicalWeatherToolDef.server(
    withProgress('Fetching tropical outlooks', ({ locationQuery }) =>
      getTropicalWeather(app, locationQuery),
    ),
  )
  const marine = getMarineOceanGuidanceToolDef.server(
    withProgress('Fetching marine guidance', ({ locationQuery }) =>
      getMarineOceanGuidance(app, locationQuery),
    ),
  )
  const upperAir = getUpperAirSoundingsToolDef.server(
    withProgress('Fetching upper-air soundings', ({ locationQuery }) =>
      getUpperAirSoundings(app, locationQuery),
    ),
  )
  const historicalClimate = getHistoricalClimateToolDef.server(
    withProgress('Fetching historical climate data', ({ locationQuery }) =>
      getHistoricalClimate(app, locationQuery),
    ),
  )
  const stormHistory = getStormHistoryToolDef.server(
    withProgress('Fetching storm history', ({ locationQuery }) =>
      getStormHistory(app, locationQuery),
    ),
  )
  const weatherArtifact = generateWeatherArtifactToolDef.server(
    withProgress('Generating weather artifact', async (args) =>
      generateArtifact(app, args as any),
    ),
  )
  const synthesis = synthesizeWeatherConclusionToolDef.server(
    withProgress('Synthesizing weather conclusion', async (args) =>
      synthesizeWeatherConclusion(args as any),
    ),
  )

  const coreTools: Array<ServerTool<any, any>> = [
    resolveLocation,
    currentConditions,
    forecast,
    alerts,
  ]
  const artifactTools: Array<ServerTool<any, any>> =
    classification.needsArtifact ? [weatherArtifact] : []
  const buildWeatherToolSet = (extraTools: Array<ServerTool<any, any>>) =>
    buildToolSet(coreTools, [...extraTools, ...artifactTools])

  switch (classification.intent) {
    case 'aviation':
      return buildWeatherToolSet([aviationContext, synthesis])
    case 'severe-weather':
      return buildWeatherToolSet([
        severeContext,
        shortRangeGuidance,
        radarSatelliteNowcast,
        synthesis,
      ])
    case 'fire-weather':
      return buildWeatherToolSet([fireWeather, shortRangeGuidance])
    case 'precipitation':
    case 'hydrology':
      return buildWeatherToolSet([
        precipFloodContext,
        radarSatelliteNowcast,
        synthesis,
      ])
    case 'winter-weather':
      return buildWeatherToolSet([wpcWinter, shortRangeGuidance])
    case 'medium-range':
    case 'global-model':
      return buildWeatherToolSet([globalGuidance, wpcMedium, synthesis])
    case 'radar':
    case 'radar-analysis':
    case 'satellite':
    case 'mrms':
      return buildWeatherToolSet([radarSatelliteNowcast, synthesis])
    case 'short-range-model':
    case 'blend-analysis':
      return buildWeatherToolSet([
        shortRangeGuidance,
        radarSatelliteNowcast,
        synthesis,
      ])
    case 'tropical':
      return buildWeatherToolSet([tropical])
    case 'marine':
      return buildWeatherToolSet([marine])
    case 'upper-air':
      return buildWeatherToolSet([upperAir])
    case 'historical-climate':
      return buildWeatherToolSet([historicalClimate])
    case 'storm-history':
      return buildWeatherToolSet([stormHistory, historicalClimate])
    case 'research-brief':
    case 'weather-analysis':
      return buildWeatherToolSet([
        severeContext,
        precipFloodContext,
        radarSatelliteNowcast,
        shortRangeGuidance,
        globalGuidance,
        synthesis,
      ])
    default:
      return buildWeatherToolSet([])
  }
}
