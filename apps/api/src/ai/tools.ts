import {
  compareWeatherCandidatesToolDef,
  generateWeatherArtifactToolDef,
  getAlertsToolDef,
  getAviationContextToolDef,
  getCurrentConditionsToolDef,
  getFireWeatherProductsToolDef,
  getForecastToolDef,
  getHistoricalClimateToolDef,
  getMarineOceanGuidanceToolDef,
  getSevereContextToolDef,
  deriveGlobalWeatherToolDef,
  deriveHydrologyWeatherToolDef,
  deriveRadarNowcastToolDef,
  deriveSatelliteWeatherToolDef,
  deriveShortRangeWeatherToolDef,
  getStormHistoryToolDef,
  getTropicalWeatherToolDef,
  getUpperAirSoundingsToolDef,
  type RequestClassification,
  resolveLocationToolDef,
  synthesizeWeatherConclusionToolDef,
} from '@raincheck/contracts'
import type { ServerTool } from '@tanstack/ai'
import type { FastifyInstance } from 'fastify'
import { getHistoricalClimate, getStormHistory } from '../weather/climate'
import { planWeatherDerivations } from '../weather/derivation-plan'
import { getAviationContext, getSevereContext } from '../weather/domain-tools'
import { getFireWeatherProducts } from '../weather/fire-weather'
import { geocodeQuery } from '../weather/geocode'
import { getMarineOceanGuidance } from '../weather/marine'
import { getAlerts, getCurrentConditions, getForecast } from '../weather/nws'
import { buildWeatherEnvelope, type WeatherSignal } from '../weather/runtime'
import {
  deriveGlobalWeather,
  deriveHydrologyWeather,
  deriveRadarNowcast,
  deriveSatelliteWeather,
  deriveShortRangeWeather,
  generateArtifact,
  synthesizeWeatherConclusion,
} from '../weather/service-client'
import {
  formatIsoLocalTimeRange,
  normalizeTimingLanguage,
} from '../weather/timing-language'
import {
  isBroadSevereLocatorQuestion,
  resolveOriginLocation,
  selectBroadChaseTarget,
} from '../weather/chase-targeting'
import {
  buildComparisonLimitationContext,
  runWeatherComparison,
} from '../weather/comparison'
import { getTropicalWeather } from '../weather/tropical'
import { getUpperAirSoundings } from '../weather/upper-air'
import {
  applyAnswerToneToText,
  buildComparisonLimitationText,
} from './answer-tone'
import type { WeatherAnswerContext } from './weather-context'

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

function shouldSynthesize(classification: RequestClassification) {
  return [
    'aviation',
    'severe-weather',
    'precipitation',
    'hydrology',
    'medium-range',
    'global-model',
    'radar',
    'radar-analysis',
    'satellite',
    'mrms',
    'short-range-model',
    'blend-analysis',
    'weather-analysis',
    'research-brief',
    'winter-weather',
  ].includes(classification.intent)
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
  context?: WeatherAnswerContext,
  messages?: Array<any>,
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
  const severeContext = getSevereContextToolDef.server(
    withProgress('Fetching severe-weather context', ({ locationQuery }) =>
      getSevereContext(app, locationQuery ?? 'United States'),
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
  const compareWeather = compareWeatherCandidatesToolDef.server(
    withProgress('Comparing weather candidates', async (args) => {
      const input = args as any
      const answerTone = input.answerTone ?? context?.answerTone ?? 'casual'
      const rankingObjective =
        input.rankingObjective ??
        classification.rankingObjective ??
        (classification.intent === 'severe-weather'
          ? 'severe-favorability'
          : 'pleasant-weather')
      const comparison = await runWeatherComparison({
        app,
        classification: {
          ...classification,
          answerMode: input.answerMode ?? classification.answerMode,
          candidateMode: input.candidateMode ?? classification.candidateMode,
          rankLimit: input.rankLimit ?? classification.rankLimit,
          rankingObjective,
        },
        userQuestion: String(input.userQuestion ?? ''),
        context,
        messages,
        explicitCandidates: Array.isArray(input.candidates)
          ? input.candidates
          : undefined,
        explicitDiscoveryScope: input.discoveryScope,
        explicitOriginLocation: input.originLocation,
        answerTone,
        displayTimezone: input.displayTimezone,
        timeDisplay: input.timeDisplay,
      })

      if (comparison) {
        return comparison
      }

      const comparisonContext = await buildComparisonLimitationContext({
        app,
        classification: {
          ...classification,
          answerMode: input.answerMode ?? classification.answerMode,
          candidateMode: input.candidateMode ?? classification.candidateMode,
          rankLimit: input.rankLimit ?? classification.rankLimit,
          rankingObjective,
        },
        userQuestion: String(input.userQuestion ?? ''),
        context,
        messages,
        explicitDiscoveryScope: input.discoveryScope,
        explicitOriginLocation: input.originLocation,
      })

      return {
        answerMode: input.answerMode ?? classification.answerMode,
        rankingObjective,
        rankLimit: input.rankLimit ?? classification.rankLimit,
        bottomLine: buildComparisonLimitationText(
          {
            ...classification,
            answerMode: input.answerMode ?? classification.answerMode,
            candidateMode: input.candidateMode ?? classification.candidateMode,
          },
          answerTone,
        ),
        confidence: {
          level: 'low' as const,
          reason: applyAnswerToneToText(
            'No valid comparison candidates could be resolved from the request yet.',
            answerTone,
          ),
        },
        whyRainCheckThinksThat: applyAnswerToneToText(
          'The ranking can only run after at least one place or search area resolves cleanly.',
          answerTone,
        ),
        rankedCandidates: [],
        recommendedCards: [],
        citations: [],
        comparisonContext,
      }
    }),
  )
  const synthesis = synthesizeWeatherConclusionToolDef.server(
    withProgress('Synthesizing weather conclusion', async (args) => {
      const input = args as any
      const originLocation =
        input.originLocation ??
        (await resolveOriginLocation({
          app,
          context,
          fallbackLocation:
            input.region?.type === 'point' && input.region?.location
              ? input.region.location
              : null,
        }))

      let selectedTarget = input.selectedTarget
      let nightfall = input.nightfall
      if (
        classification.intent === 'severe-weather' &&
        isBroadSevereLocatorQuestion(classification, String(input.userQuestion ?? '')) &&
        originLocation &&
        !selectedTarget
      ) {
        try {
          const chaseTarget = await selectBroadChaseTarget({
            app,
            originLocation,
            referenceTime: input.timeWindow?.referenceTime,
          })
          selectedTarget = chaseTarget?.selectedTarget
          nightfall = chaseTarget?.nightfall
        } catch {
          // Best-effort enrichment only.
        }
      }

      return synthesizeWeatherConclusion(app, {
        ...input,
        originLocation: originLocation ?? undefined,
        displayTimezone:
          input.displayTimezone ??
          context?.displayTimezone ??
          context?.locationHint?.timezone,
        answerTone: input.answerTone ?? context?.answerTone ?? 'casual',
        timeDisplay: input.timeDisplay ?? context?.timeDisplay ?? 'user-local',
        selectedTarget: selectedTarget ?? undefined,
        nightfall: nightfall ?? undefined,
      })
    }),
  )

  const shortRangeDerive = deriveShortRangeWeatherToolDef.server(
    withProgress('Deriving short-range weather evidence', async (args) =>
      deriveShortRangeWeather(app, args as any),
    ),
  )
  const globalDerive = deriveGlobalWeatherToolDef.server(
    withProgress('Deriving global weather evidence', async (args) =>
      deriveGlobalWeather(app, args as any),
    ),
  )
  const radarDerive = deriveRadarNowcastToolDef.server(
    withProgress('Deriving radar nowcast evidence', async (args) =>
      deriveRadarNowcast(app, args as any),
    ),
  )
  const satelliteDerive = deriveSatelliteWeatherToolDef.server(
    withProgress('Deriving satellite weather evidence', async (args) =>
      deriveSatelliteWeather(app, args as any),
    ),
  )
  const hydrologyDerive = deriveHydrologyWeatherToolDef.server(
    withProgress('Deriving hydrology weather evidence', async (args) =>
      deriveHydrologyWeather(app, args as any),
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
  const deriveToolByEndpoint: Record<
    'short-range' | 'global' | 'radar-nowcast' | 'satellite' | 'hydrology',
    ServerTool<any, any>
  > = {
    'short-range': shortRangeDerive,
    global: globalDerive,
    'radar-nowcast': radarDerive,
    satellite: satelliteDerive,
    hydrology: hydrologyDerive,
  }
  const selectedDerivations = planWeatherDerivations(classification).map(
    (endpoint) => deriveToolByEndpoint[endpoint],
  )
  const synthesisTools =
    classification.answerMode === 'single' && shouldSynthesize(classification)
      ? [synthesis]
      : []
  const comparisonTools =
    classification.answerMode !== 'single' ? [compareWeather] : []
  const buildWeatherToolSet = (extraTools: Array<ServerTool<any, any>>) =>
    buildToolSet(coreTools, [
      ...extraTools,
      ...comparisonTools,
      ...synthesisTools,
      ...artifactTools,
    ])

  switch (classification.intent) {
    case 'aviation':
      return buildWeatherToolSet([aviationContext])
    case 'severe-weather':
      return buildWeatherToolSet([severeContext, ...selectedDerivations])
    case 'fire-weather':
      return buildWeatherToolSet([fireWeather, ...selectedDerivations])
    case 'precipitation':
    case 'hydrology':
      return buildWeatherToolSet(selectedDerivations)
    case 'winter-weather':
      return buildWeatherToolSet(selectedDerivations)
    case 'medium-range':
    case 'global-model':
      return buildWeatherToolSet(selectedDerivations)
    case 'radar':
    case 'radar-analysis':
    case 'satellite':
    case 'mrms':
      return buildWeatherToolSet(selectedDerivations)
    case 'short-range-model':
    case 'blend-analysis':
      return buildWeatherToolSet(selectedDerivations)
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
      return buildWeatherToolSet(selectedDerivations)
    default:
      return buildWeatherToolSet([])
  }
}
