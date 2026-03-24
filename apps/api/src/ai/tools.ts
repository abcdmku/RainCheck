import {
  compareModelsToolDef,
  generateCitationBundleToolDef,
  generateReportOutlineToolDef,
  generateWeatherArtifactToolDef,
  getAlertsToolDef,
  getAviationWeatherToolDef,
  getBlendAndAnalysisGuidanceToolDef,
  getCurrentConditionsToolDef,
  getFireWeatherProductsToolDef,
  getForecastToolDef,
  getGlobalModelGuidanceToolDef,
  getGoesSatelliteToolDef,
  getHistoricalClimateToolDef,
  getHydrologyNwpsToolDef,
  getMarineOceanGuidanceToolDef,
  getMrmsProductsToolDef,
  getNexradRadarToolDef,
  getShortRangeModelGuidanceToolDef,
  getSpcSevereProductsToolDef,
  getStormHistoryToolDef,
  getTropicalWeatherToolDef,
  getUpperAirSoundingsToolDef,
  getWpcMediumRangeHazardsToolDef,
  getWpcQpfEroToolDef,
  getWpcWinterWeatherToolDef,
  resolveLocationToolDef,
  type RequestClassification,
} from '@raincheck/contracts'
import type { ServerTool } from '@tanstack/ai'
import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from '../weather/geocode'
import { getAviationSummary } from '../weather/aviation'
import { getHistoricalClimate, getStormHistory } from '../weather/climate'
import { getFireWeatherProducts } from '../weather/fire-weather'
import { getHydrologyNwps } from '../weather/hydrology'
import { getMarineOceanGuidance } from '../weather/marine'
import {
  compareModels,
  getBlendAndAnalysisGuidance,
  getGlobalModelGuidance,
  getShortRangeModelGuidance,
} from '../weather/models'
import { getMrmsProducts } from '../weather/mrms'
import { getAlerts, getCurrentConditions, getForecast } from '../weather/nws'
import { getNexradRadar } from '../weather/radar'
import { getGoesSatellite } from '../weather/satellite'
import { generateArtifact } from '../weather/service-client'
import { chooseSourceManifests } from '../weather/source-selection'
import { getSpcSevereProducts } from '../weather/spc'
import { getTropicalWeather } from '../weather/tropical'
import { getUpperAirSoundings } from '../weather/upper-air'
import { buildWeatherEnvelope } from '../weather/runtime'
import {
  getWpcMediumRangeHazards,
  getWpcQpfEro,
  getWpcWinterWeather,
} from '../weather/wpc'

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

function wrapCurrentConditions(result: Awaited<ReturnType<typeof getCurrentConditions>>) {
  const temp = `${result.temperature.value}${result.temperature.unit}`
  const wind =
    result.wind.speed != null
      ? `Wind ${result.wind.speed} mph${result.wind.direction ? ` ${result.wind.direction}` : ''}.`
      : 'Wind data unavailable.'

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
    confidence: 0.94,
    summary: `${result.textDescription} around ${temp}. ${wind}`.trim(),
    data: {
      current: result,
    },
    citations: [result.source],
  })
}

function wrapForecast(result: Awaited<ReturnType<typeof getForecast>>) {
  const first = result.periods[0]
  const last = result.periods.at(-1)
  const summary = first
    ? `${first.name}: ${first.shortForecast}, near ${first.temperature}${first.temperatureUnit}.`
    : `Forecast context for ${result.location.name}.`

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
    confidence: 0.9,
    summary,
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
  const summary =
    firstAlert != null
      ? `${result.length} active alert${result.length === 1 ? '' : 's'} for ${location.name}. Most urgent: ${firstAlert.headline}.`
      : `No active alerts for ${location.name} at fetch time.`

  const validRange =
    firstAlert?.effective && firstAlert.expires
      ? {
          start: firstAlert.effective,
          end: firstAlert.expires,
        }
      : undefined

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
    confidence: 0.96,
    summary,
    data: {
      alerts: result,
    },
    citations: result.map((alert) => alert.source),
  })
}

function wrapAviation(result: Awaited<ReturnType<typeof getAviationSummary>>, stationId: string) {
  return buildWeatherEnvelope({
    source: {
      sourceId: 'aviationweather-gov',
      productId: 'aviation-summary',
      label: 'Aviation Weather Center',
      url: result.citations[0]?.url ?? 'https://aviationweather.gov/data/api/',
    },
    location: {
      query: stationId,
      name: stationId,
      latitude: 0,
      longitude: 0,
      resolvedBy: 'station-id',
    },
    units: {
      aviation: 'aviation-native',
    },
    validAt: nowIso(),
    confidence: 0.85,
    summary: result.summary,
    data: {
      stationId: result.stationId,
      metar: result.metar,
      taf: result.taf,
    },
    citations: result.citations,
  })
}

function buildResearchOutline(title: string, focus: string) {
  return {
    title,
    sections: [
      { heading: 'Setup', summary: focus },
      {
        heading: 'Main risks',
        summary: 'Highlight the most relevant hazards, timing questions, or source disagreements.',
      },
      {
        heading: 'Uncertainty',
        summary: 'State what could change and which source should be checked next.',
      },
    ],
  }
}

function buildToolSet(
  coreTools: Array<ServerTool<any, any>>,
  extraTools: Array<ServerTool<any, any>>,
) {
  return [...new Set([...coreTools, ...extraTools])]
}

export function buildServerTools(
  app: FastifyInstance,
  classification: RequestClassification,
) {
  const resolveLocation = resolveLocationToolDef.server(
    withProgress('Resolving location', ({ query }) => geocodeQuery(app, query)),
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
  const aviation = getAviationWeatherToolDef.server(
    withProgress('Fetching aviation weather', async ({ stationId }) =>
      wrapAviation(await getAviationSummary(app, stationId), stationId),
    ),
  )
  const spcSevere = getSpcSevereProductsToolDef.server(
    withProgress('Fetching severe-weather outlooks', ({ locationQuery }) =>
      getSpcSevereProducts(app, locationQuery),
    ),
  )
  const fireWeather = getFireWeatherProductsToolDef.server(
    withProgress('Fetching fire-weather outlooks', ({ locationQuery }) =>
      getFireWeatherProducts(app, locationQuery),
    ),
  )
  const wpcQpfEro = getWpcQpfEroToolDef.server(
    withProgress('Fetching rainfall outlooks', ({ locationQuery }) =>
      getWpcQpfEro(app, locationQuery),
    ),
  )
  const wpcWinter = getWpcWinterWeatherToolDef.server(
    withProgress('Fetching winter weather guidance', ({ locationQuery }) =>
      getWpcWinterWeather(app, locationQuery),
    ),
  )
  const wpcMedium = getWpcMediumRangeHazardsToolDef.server(
    withProgress('Fetching medium-range hazards', ({ locationQuery }) =>
      getWpcMediumRangeHazards(app, locationQuery),
    ),
  )
  const hydrology = getHydrologyNwpsToolDef.server(
    withProgress('Fetching hydrology guidance', ({ locationQuery }) =>
      getHydrologyNwps(app, locationQuery),
    ),
  )
  const nexrad = getNexradRadarToolDef.server(
    withProgress('Fetching radar context', ({ locationQuery }) =>
      getNexradRadar(app, locationQuery),
    ),
  )
  const goes = getGoesSatelliteToolDef.server(
    withProgress('Fetching satellite context', ({ locationQuery }) =>
      getGoesSatellite(app, locationQuery),
    ),
  )
  const mrms = getMrmsProductsToolDef.server(
    withProgress('Fetching MRMS products', ({ locationQuery }) =>
      getMrmsProducts(app, locationQuery),
    ),
  )
  const shortRangeModels = getShortRangeModelGuidanceToolDef.server(
    withProgress('Fetching short-range model guidance', ({ locationQuery }) =>
      getShortRangeModelGuidance(app, locationQuery),
    ),
  )
  const blendAnalysis = getBlendAndAnalysisGuidanceToolDef.server(
    withProgress('Fetching blend and analysis guidance', ({ locationQuery }) =>
      getBlendAndAnalysisGuidance(app, locationQuery),
    ),
  )
  const globalModels = getGlobalModelGuidanceToolDef.server(
    withProgress('Fetching global model guidance', ({ locationQuery }) =>
      getGlobalModelGuidance(app, locationQuery),
    ),
  )
  const modelComparison = compareModelsToolDef.server(
    withProgress('Comparing model guidance', async ({ locationName, comparedModels }) =>
      compareModels(locationName, comparedModels),
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
  const citations = generateCitationBundleToolDef.server(
    withProgress('Assembling source bundle', async ({ sourceIds, productIds }) => ({
      citations: sourceIds.map((sourceId, index) => ({
        id: `${sourceId}:${productIds[index] ?? 'catalog'}`,
        label: `${sourceId} ${productIds[index] ?? 'catalog'}`,
        sourceId,
        productId: productIds[index] ?? 'catalog',
      })),
      manifests: chooseSourceManifests(classification).filter((manifest) =>
        sourceIds.includes(manifest.sourceId),
      ),
    })),
  )
  const reportOutline = generateReportOutlineToolDef.server(
    withProgress('Planning weather brief', async ({ title, focus }) =>
      buildResearchOutline(title, focus),
    ),
  )
  const artifact = generateWeatherArtifactToolDef.server(
    withProgress('Generating weather artifact', ({ artifactType, locationQuery, prompt }) =>
      generateArtifact(app, { artifactType, locationQuery, prompt }),
    ),
  )

  const coreTools: Array<ServerTool<any, any>> = [
    resolveLocation,
    currentConditions,
    forecast,
    alerts,
  ]

  switch (classification.intent) {
    case 'aviation':
      return buildToolSet(coreTools, [aviation, citations])
    case 'severe-weather':
      return buildToolSet(coreTools, [
        spcSevere,
        nexrad,
        goes,
        mrms,
        shortRangeModels,
        reportOutline,
        artifact,
        citations,
      ])
    case 'fire-weather':
      return buildToolSet(coreTools, [fireWeather, forecast, reportOutline, citations])
    case 'precipitation':
      return buildToolSet(coreTools, [
        wpcQpfEro,
        hydrology,
        mrms,
        blendAnalysis,
        artifact,
        citations,
      ])
    case 'winter-weather':
      return buildToolSet(coreTools, [
        wpcWinter,
        shortRangeModels,
        blendAnalysis,
        artifact,
        citations,
      ])
    case 'medium-range':
      return buildToolSet(coreTools, [
        wpcMedium,
        globalModels,
        modelComparison,
        reportOutline,
        citations,
      ])
    case 'hydrology':
      return buildToolSet(coreTools, [
        hydrology,
        wpcQpfEro,
        mrms,
        artifact,
        reportOutline,
        citations,
      ])
    case 'radar':
    case 'radar-analysis':
      return buildToolSet(coreTools, [
        nexrad,
        mrms,
        spcSevere,
        artifact,
        reportOutline,
        citations,
      ])
    case 'satellite':
      return buildToolSet(coreTools, [goes, artifact, citations])
    case 'mrms':
      return buildToolSet(coreTools, [mrms, nexrad, hydrology, artifact, citations])
    case 'short-range-model':
      return buildToolSet(coreTools, [
        shortRangeModels,
        blendAnalysis,
        modelComparison,
        artifact,
        citations,
      ])
    case 'blend-analysis':
      return buildToolSet(coreTools, [
        blendAnalysis,
        shortRangeModels,
        modelComparison,
        citations,
      ])
    case 'global-model':
      return buildToolSet(coreTools, [
        globalModels,
        modelComparison,
        wpcMedium,
        reportOutline,
        citations,
      ])
    case 'model-comparison':
      return buildToolSet(coreTools, [
        shortRangeModels,
        blendAnalysis,
        globalModels,
        modelComparison,
        artifact,
        reportOutline,
        citations,
      ])
    case 'tropical':
      return buildToolSet(coreTools, [tropical, reportOutline, artifact, citations])
    case 'marine':
      return buildToolSet(coreTools, [marine, artifact, citations])
    case 'upper-air':
      return buildToolSet(coreTools, [upperAir, artifact, reportOutline, citations])
    case 'historical-climate':
      return buildToolSet(coreTools, [
        historicalClimate,
        reportOutline,
        artifact,
        citations,
      ])
    case 'storm-history':
      return buildToolSet(coreTools, [
        stormHistory,
        historicalClimate,
        reportOutline,
        artifact,
        citations,
      ])
    case 'research-brief':
    case 'weather-analysis':
      return buildToolSet(coreTools, [
        spcSevere,
        wpcQpfEro,
        hydrology,
        nexrad,
        goes,
        mrms,
        shortRangeModels,
        blendAnalysis,
        globalModels,
        tropical,
        marine,
        upperAir,
        historicalClimate,
        stormHistory,
        reportOutline,
        artifact,
        citations,
      ])
    default:
      return buildToolSet(coreTools, [citations])
  }
}
