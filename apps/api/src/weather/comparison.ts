import {
  type RequestClassification,
  weatherComparisonBundleSchema,
  weatherComparisonContextSchema,
  weatherComparisonRequestSchema,
  weatherComparisonToolRequestSchema,
} from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'

import type { WeatherAnswerContext } from '../ai/weather-context'
import {
  buildWeatherDerivationRequest,
  type NormalizedWeatherLocation,
} from './derivation-plan'
import { getSevereContext } from './domain-tools'
import { geocodeQuery } from './geocode'
import { getMarineOceanGuidance } from './marine'
import { getAlerts, getCurrentConditions, getForecast } from './nws'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherJson,
  type WeatherSignal,
} from './runtime'
import {
  compareWeatherCandidates as compareWeatherCandidatesService,
  deriveRadarNowcast,
  deriveShortRangeWeather,
} from './service-client'
import { formatIsoLocalTimeRange, normalizeTimingLanguage } from './timing-language'
import {
  rankBroadChaseTargets,
  resolveOriginLocation,
} from './chase-targeting'

type WeatherComparisonToolRequest = z.infer<
  typeof weatherComparisonToolRequestSchema
>
type WeatherComparisonBundle = z.infer<typeof weatherComparisonBundleSchema>
type WeatherComparisonContext = z.infer<typeof weatherComparisonContextSchema>
type ComparisonCandidate = WeatherComparisonContext['candidates'][number]
type CandidateInput = WeatherComparisonToolRequest['candidates'][number]
type DiscoveryScope = NonNullable<WeatherComparisonToolRequest['discoveryScope']>

type OverpassResponse = {
  elements?: Array<{
    id: number
    lat?: number
    lon?: number
    center?: {
      lat?: number
      lon?: number
    }
    tags?: Record<string, string>
  }>
}

const compareFollowUpTerms = [
  'what about',
  'how about',
  'did you check',
  'check the storms in',
  'which one',
  'that one',
]

const implicitNearbyContextTerms = [
  'near me',
  'around me',
  'around here',
  'nearby',
  'close to me',
  'current location',
  'my location',
  'my area',
  'my current area',
  'my current location',
]

const standaloneLocationConnectorWords = new Set(['a', 'an', 'and', 'of', 'the'])

const genericLocationNounTokens = new Set([
  'area',
  'areas',
  'beach',
  'beaches',
  'location',
  'locations',
  'place',
  'places',
  'region',
  'regions',
  'spot',
  'spots',
])

const standaloneLocationStopWords = new Set([
  'all',
  'am',
  'are',
  'be',
  'best',
  'brief',
  'can',
  'compare',
  'day',
  'did',
  'do',
  'does',
  'forecast',
  'go',
  'hail',
  'how',
  'i',
  'in',
  'is',
  'it',
  'later',
  'location',
  'map',
  'maybe',
  'me',
  'my',
  'near',
  'now',
  'no',
  'nope',
  'ok',
  'okay',
  'one',
  'please',
  'rank',
  'ranking',
  'report',
  'search',
  'show',
  'spot',
  'storm',
  'storms',
  'sure',
  'thank',
  'thanks',
  'that',
  'there',
  'this',
  'time',
  'timing',
  'today',
  'tomorrow',
  'tonight',
  'weather',
  'what',
  'when',
  'where',
  'why',
  'will',
  'wind',
  'with',
  'would',
  'yeah',
  'yep',
  'yes',
])

function confidenceLevel(value: number): 'low' | 'medium' | 'high' {
  if (value >= 0.8) {
    return 'high'
  }

  if (value >= 0.6) {
    return 'medium'
  }

  return 'low'
}

function normalizeText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

function shouldUseImplicitNearbyContext(userQuestion: string) {
  const normalized = normalizeText(userQuestion)
  return implicitNearbyContextTerms.some((term) =>
    normalized.includes(normalizeText(term)),
  )
}

export function extractStandaloneLocationQuery(userQuestion: string) {
  const trimmed = userQuestion.trim().replace(/[?.!]+$/, '').trim()
  if (!trimmed || trimmed.length > 80) {
    return null
  }

  const normalized = normalizeText(trimmed)
  if (!normalized) {
    return null
  }

  if (
    normalized.includes(' near ') ||
    normalized.includes(' around ') ||
    normalized.includes(' between ') ||
    normalized.includes(' across ') ||
    normalized.includes(' for ') ||
    normalized.includes(' at ') ||
    normalized.includes(' on ')
  ) {
    return null
  }

  if (
    /\b(?:what|when|where|why|how|show|compare|rank|best|should|could|would|will|can|do|does|did|is|are|was|were)\b/.test(
      normalized,
    )
  ) {
    return null
  }

  const tokens = normalized.split(' ').filter(Boolean)
  if (tokens.length === 0 || tokens.length > 6) {
    return null
  }

  const significantTokens = tokens.filter(
    (token) => !standaloneLocationConnectorWords.has(token),
  )
  if (significantTokens.length === 0 || significantTokens.length > 6) {
    return null
  }

  if (
    significantTokens.every(
      (token) => token.length < 2 || standaloneLocationStopWords.has(token),
    )
  ) {
    return null
  }

  if (significantTokens.some((token) => standaloneLocationStopWords.has(token))) {
    return null
  }

  return trimmed
}

function sanitizeExtractedLocationQuery(value: string | null | undefined) {
  const trimmed = value?.trim().replace(/[?.!]+$/, '').trim()
  if (!trimmed) {
    return null
  }

  const normalized = normalizeText(trimmed)
  if (!normalized || /\b(?:and|or)\b$/.test(normalized)) {
    return null
  }

  const significantTokens = normalized
    .split(' ')
    .filter(Boolean)
    .filter((token) => !standaloneLocationConnectorWords.has(token))

  if (significantTokens.length === 0) {
    return null
  }

  if (significantTokens.every((token) => genericLocationNounTokens.has(token))) {
    return null
  }

  return trimmed
}

export function extractLocationQueryFromQuestion(userQuestion: string) {
  const coordinateMatch = userQuestion.match(
    /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
  )
  if (coordinateMatch) {
    return `${coordinateMatch[1]}, ${coordinateMatch[2]}`
  }

  const locationMatch = userQuestion.match(
    /\b(?:in|near|around|for|across|between|at|on)\s+([a-z0-9 .,'-]+?)(?=\s+(?:what|what's|whats|where|where's|wheres|when|when's|whens|which|should|could|would|will|do|does|did|because|according|currently|tonight|today|tomorrow|this|other|storms?|tornado(?:s|es)?|hail|wind|beaches?|locations?)\b|[?.!,]|$)/i,
  )
  return (
    sanitizeExtractedLocationQuery(locationMatch?.[1]) ??
    extractStandaloneLocationQuery(userQuestion)
  )
}

function cleanCandidatePhrase(value: string) {
  return value
    .replace(/\b(?:the|storms?|weather|locations?|spots?|areas?)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function splitCandidatePhrase(value: string) {
  return value
    .split(/\s*(?:,|(?:\band\b)|(?:\bor\b)|(?:\bvs\.?\b)|(?:\bversus\b))\s*/i)
    .map((entry) => cleanCandidatePhrase(entry))
    .filter((entry) => entry.length >= 3)
}

function extractNamedCandidateInputs(
  userQuestion: string,
): Array<{ query: string; label?: string; source: CandidateInput['source'] }> {
  const matches: Array<string> = []
  const patterns = [
    /\bcompare(?:\s+the\s+(?:two|following))?(?:\s+(?:storms?|weather|locations?))?(?:\s+(?:between|for|in))?\s+(.+?)(?=\s+(?:which|what|who|looks?|seems?|is|are)\b|[?.!]|$)/i,
    /\bwhat about\s+(.+?)(?=\s+(?:which|what|who|looks?|seems?|is|are|currently|today|tomorrow|tonight)\b|[?.!]|$)/i,
    /\b(?:between|among)\s+(.+?)(?=\s+(?:which|what|who|looks?|seems?|is|are)\b|[?.!]|$)/i,
    /\bin\s+([a-z0-9 .,'-]+(?:\s+(?:and|or|vs\.?|versus)\s+[a-z0-9 .,'-]+)+)(?=[?.!]|$|\s+(?:which|what|who|looks?|seems?|is|are)\b)/i,
  ]

  for (const pattern of patterns) {
    const match = userQuestion.match(pattern)
    if (match?.[1]) {
      matches.push(match[1])
    }
  }

  const deduped = new Map<string, { query: string; label?: string; source: CandidateInput['source'] }>()
  for (const match of matches) {
    for (const segment of splitCandidatePhrase(match)) {
      const key = normalizeText(segment)
      if (!key) {
        continue
      }
      deduped.set(key, {
        query: segment,
        label: segment,
        source: 'user',
      })
    }
  }

  return [...deduped.values()]
}

function levenshtein(left: string, right: string) {
  const rows = Array.from({ length: left.length + 1 }, (_, index) => [index])
  for (let column = 1; column <= right.length; column += 1) {
    rows[0]![column] = column
  }

  for (let row = 1; row <= left.length; row += 1) {
    for (let column = 1; column <= right.length; column += 1) {
      const substitutionCost = left[row - 1] === right[column - 1] ? 0 : 1
      rows[row]![column] = Math.min(
        rows[row - 1]![column]! + 1,
        rows[row]![column - 1]! + 1,
        rows[row - 1]![column - 1]! + substitutionCost,
      )
    }
  }

  return rows[left.length]![right.length]!
}

export function candidateMentionedInQuestion(
  userQuestion: string,
  candidate: ComparisonCandidate,
) {
  const normalizedQuestion = normalizeText(userQuestion)
  const questionTokens = normalizedQuestion
    .split(' ')
    .filter((token) => token.length >= 4)
  const aliases = [
    candidate.label,
    candidate.location.name,
    candidate.location.query,
  ]
    .filter(Boolean)
    .map((value) => String(value))

  for (const alias of aliases) {
    const normalizedAlias = normalizeText(alias)
    if (normalizedAlias && normalizedQuestion.includes(normalizedAlias)) {
      return true
    }

    const aliasTokens = normalizedAlias
      .split(' ')
      .filter((token) => token.length >= 4)
    for (const aliasToken of aliasTokens) {
      if (
        questionTokens.some(
          (questionToken) =>
            questionToken === aliasToken ||
            levenshtein(questionToken, aliasToken) <= 2,
        )
      ) {
        return true
      }
    }
  }

  return false
}

function isComparisonFollowUp(userQuestion: string) {
  const normalized = normalizeText(userQuestion)
  return compareFollowUpTerms.some((term) => normalized.includes(normalizeText(term)))
}

export function extractStoredWeatherComparisonContext(messages: Array<any>) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role !== 'assistant' || !Array.isArray(message.parts)) {
      continue
    }

    const contextPart = message.parts.find(
      (part: any) => part?.type === 'weather-comparison-context',
    )
    if (!contextPart) {
      continue
    }

    const parsed = weatherComparisonContextSchema.safeParse(
      contextPart.context ?? contextPart.value ?? contextPart,
    )
    if (parsed.success) {
      return parsed.data
    }
  }

  return null
}

function resolvePreviousContextCandidates(
  userQuestion: string,
  previousContext: WeatherComparisonContext | null,
) {
  if (!previousContext || previousContext.candidates.length === 0) {
    return []
  }

  const matchedCandidates = previousContext.candidates.filter((candidate) =>
    candidateMentionedInQuestion(userQuestion, candidate),
  )
  if (matchedCandidates.length > 0) {
    return previousContext.candidates
  }

  if (isComparisonFollowUp(userQuestion)) {
    return previousContext.candidates
  }

  return []
}

async function resolveCandidateInputs(
  app: FastifyInstance,
  inputs: CandidateInput[],
) {
  const resolvedCandidates: ComparisonCandidate[] = []
  const seen = new Set<string>()

  for (const candidate of inputs) {
    if (candidate.location) {
      const key = normalizeText(candidate.label ?? candidate.location.name ?? candidate.location.query ?? '')
      if (!key || seen.has(key)) {
        continue
      }

      seen.add(key)
      resolvedCandidates.push({
        query: candidate.query ?? candidate.location.query,
        label: candidate.label ?? candidate.location.name,
        location: candidate.location,
        source: candidate.source ?? 'user',
        reason: candidate.reason,
      })
      continue
    }

    const query = candidate.query ?? candidate.label
    if (!query) {
      continue
    }

    try {
      const location = await geocodeQuery(app, query)
      const key = normalizeText(candidate.label ?? location.name)
      if (!key || seen.has(key)) {
        continue
      }

      seen.add(key)
      resolvedCandidates.push({
        query,
        label: candidate.label ?? location.name,
        location,
        source: candidate.source ?? 'user',
        reason: candidate.reason,
      })
    } catch {
      // Best-effort candidate resolution.
    }
  }

  return resolvedCandidates
}

function isBeachObjective(objective: RequestClassification['rankingObjective']) {
  return objective === 'beach-day'
}

async function wrapCurrentConditionsEnvelope(
  app: FastifyInstance,
  locationQuery: string,
) {
  const result = await getCurrentConditions(app, locationQuery)
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

async function wrapForecastEnvelope(
  app: FastifyInstance,
  locationQuery: string,
) {
  const result = await getForecast(app, locationQuery, 'short')
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

async function wrapAlertsEnvelope(
  app: FastifyInstance,
  location: Awaited<ReturnType<typeof geocodeQuery>>,
) {
  const result = await getAlerts(app, location.query)
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

async function fetchCandidateAnalysis(
  app: FastifyInstance,
  classification: RequestClassification,
  objective: NonNullable<RequestClassification['rankingObjective']>,
  userQuestion: string,
  candidate: ComparisonCandidate,
) {
  const location = candidate.location as NormalizedWeatherLocation
  const locationQuery =
    location.query || location.name || `${location.latitude}, ${location.longitude}`

  if (objective === 'severe-favorability') {
    const severeContext = await getSevereContext(app, locationQuery)
    const shortRangeRequest = buildWeatherDerivationRequest({
      classification,
      endpoint: 'short-range',
      location,
      userQuestion,
    })
    const radarRequest = buildWeatherDerivationRequest({
      classification,
      endpoint: 'radar-nowcast',
      location,
      userQuestion,
    })
    const [shortRangeBundle, radarBundle] = await Promise.all([
      deriveShortRangeWeather(app, shortRangeRequest as any),
      deriveRadarNowcast(app, radarRequest as any),
    ])

    return {
      candidate,
      severeContext,
      supportingBundles: [shortRangeBundle, radarBundle],
    }
  }

  const [currentConditions, forecast, alerts, marineContext] = await Promise.all([
    wrapCurrentConditionsEnvelope(app, locationQuery),
    wrapForecastEnvelope(app, locationQuery),
    wrapAlertsEnvelope(app, location),
    isBeachObjective(objective)
      ? getMarineOceanGuidance(app, locationQuery).catch(() => null)
      : Promise.resolve(null),
  ])

  return {
    candidate,
    currentConditions,
    forecast,
    alerts,
    ...(marineContext ? { marineContext } : {}),
    supportingBundles: [],
  }
}

async function discoverBeachCandidates(
  app: FastifyInstance,
  scope: DiscoveryScope,
) {
  const center = scope.location
  if (!center) {
    return [] as ComparisonCandidate[]
  }

  const radiusKm = Math.min(scope.radiusKm ?? 180, 250)
  const around = radiusKm * 1000
  const query = `
[out:json][timeout:25];
(
  node["natural"="beach"](around:${around},${center.latitude},${center.longitude});
  way["natural"="beach"](around:${around},${center.latitude},${center.longitude});
  node["tourism"="beach_resort"](around:${around},${center.latitude},${center.longitude});
  way["tourism"="beach_resort"](around:${around},${center.latitude},${center.longitude});
);
out center tags 25;
`.trim()

  try {
    const response = await fetchWeatherJson<OverpassResponse>(
      app,
      {
        sourceId: 'overpass-openstreetmap',
        productId: 'beach-discovery',
        label: 'Overpass beach discovery',
        url: 'https://overpass-api.de/api/interpreter',
        cacheKey: cacheKey(
          'discover',
          'beach',
          center.latitude,
          center.longitude,
          radiusKm,
        ),
        ttlMs: 30 * 60 * 1000,
      },
      {
        requestInit: {
          method: 'POST',
          headers: {
            'content-type': 'text/plain',
          },
          body: query,
        },
      },
    )

    const deduped = new Map<string, ComparisonCandidate>()
    for (const element of response.value.elements ?? []) {
      const latitude = element.lat ?? element.center?.lat
      const longitude = element.lon ?? element.center?.lon
      const name = element.tags?.name?.trim()
      if (!name || typeof latitude !== 'number' || typeof longitude !== 'number') {
        continue
      }

      const key = normalizeText(name)
      if (deduped.has(key)) {
        continue
      }

      deduped.set(key, {
        query: name,
        label: name,
        location: {
          query: name,
          name,
          latitude,
          longitude,
          resolvedBy: 'osm-overpass',
        },
        source: 'beach-discovery',
        reason: scope.locationQuery
          ? `Discovered within ${scope.locationQuery}`
          : 'Discovered from the requested beach search region',
      })
    }

    return [...deduped.values()].slice(0, 12)
  } catch {
    return []
  }
}

async function discoverPleasantWeatherCandidates(input: {
  app: FastifyInstance
  userQuestion: string
  context?: WeatherAnswerContext
  previousContext?: WeatherComparisonContext | null
}) {
  const regionQuery =
    extractLocationQueryFromQuestion(input.userQuestion) ??
    input.context?.locationHint?.label ??
    input.previousContext?.originLocation?.query ??
    input.previousContext?.discoveryScope?.locationQuery ??
    null
  const baseLocation =
    (input.context?.locationHint?.latitude != null &&
    input.context?.locationHint?.longitude != null
      ? {
          query: input.context.locationHint.label ?? 'Current area',
          name: input.context.locationHint.label ?? 'Current area',
          latitude: input.context.locationHint.latitude,
          longitude: input.context.locationHint.longitude,
          timezone: input.context.locationHint.timezone,
          resolvedBy: 'weather-context',
        }
      : input.previousContext?.originLocation) ??
    input.previousContext?.discoveryScope?.location ??
    (regionQuery ? await geocodeQuery(input.app, regionQuery).catch(() => null) : null)

  if (!baseLocation) {
    return [] as ComparisonCandidate[]
  }

  const regionLabel =
    baseLocation.region?.trim() || regionQuery || baseLocation.name || baseLocation.query
  const seedQueries = [
    `north ${regionLabel}`,
    `west ${regionLabel}`,
    `central ${regionLabel}`,
    `east ${regionLabel}`,
    `south ${regionLabel}`,
  ].map((query) => ({
    query,
    label: query,
    source: 'follow-up-context' as const,
    reason: `Discovered from the broader ${regionLabel} weather region`,
  }))

  return resolveCandidateInputs(input.app, seedQueries)
}

function inferWeatherDiscoveryScope(
  objective: NonNullable<RequestClassification['rankingObjective']>,
  userQuestion: string,
  context?: WeatherAnswerContext,
  previousContext?: WeatherComparisonContext | null,
) {
  const explicitLocationQuery = extractLocationQueryFromQuestion(userQuestion)
  const previousDiscoveryScope = previousContext?.discoveryScope
  const useImplicitNearbyContext =
    !explicitLocationQuery &&
    !previousDiscoveryScope &&
    shouldUseImplicitNearbyContext(userQuestion)
  const implicitLocationQuery = useImplicitNearbyContext
    ? context?.locationHint?.label ?? null
    : null
  const locationQuery =
    explicitLocationQuery ??
    previousDiscoveryScope?.locationQuery ??
    implicitLocationQuery ??
    null
  const contextLocation =
    context?.locationHint?.latitude != null &&
    context?.locationHint?.longitude != null
      ? {
          query: context.locationHint.label ?? 'Current area',
          name: context.locationHint.label ?? 'Current area',
          latitude: context.locationHint.latitude,
          longitude: context.locationHint.longitude,
          timezone: context.locationHint.timezone,
          resolvedBy: 'weather-context',
        }
      : null
  const carriedLocation = explicitLocationQuery
    ? undefined
    : useImplicitNearbyContext
      ? contextLocation ?? undefined
      : previousDiscoveryScope?.location

  if (objective === 'beach-day') {
    if (!locationQuery && !carriedLocation) {
      return null
    }

    return {
      category: 'beach' as const,
      locationQuery: locationQuery ?? undefined,
      location: carriedLocation,
      radiusKm: previousDiscoveryScope?.radiusKm ?? 180,
    }
  }

  if (objective === 'severe-favorability') {
    return {
      category: 'severe-weather' as const,
      locationQuery: locationQuery ?? undefined,
      location: carriedLocation ?? contextLocation ?? previousDiscoveryScope?.location,
      radiusKm: previousDiscoveryScope?.radiusKm ?? 220,
    }
  }

  return null
}

async function resolveDiscoveryLocation(
  app: FastifyInstance,
  scope: DiscoveryScope | null,
) {
  if (!scope) {
    return null
  }

  if (scope.location) {
    return scope
  }

  if (!scope.locationQuery) {
    return null
  }

  try {
    const location = await geocodeQuery(app, scope.locationQuery)
    return {
      ...scope,
      location,
    }
  } catch {
    return null
  }
}

async function discoverComparisonCandidates(input: {
  app: FastifyInstance
  classification: RequestClassification
  userQuestion: string
  context?: WeatherAnswerContext
  previousContext?: WeatherComparisonContext | null
}) {
  const objective = input.classification.rankingObjective
  if (!objective) {
    return { candidates: [] as ComparisonCandidate[], discoveryScope: null }
  }

  const rawScope = inferWeatherDiscoveryScope(
    objective,
    input.userQuestion,
    input.context,
    input.previousContext,
  )
  const discoveryScope = await resolveDiscoveryLocation(input.app, rawScope)
  if (!discoveryScope) {
    return { candidates: [] as ComparisonCandidate[], discoveryScope: null }
  }

  if (objective === 'beach-day') {
    return {
      candidates: await discoverBeachCandidates(input.app, discoveryScope),
      discoveryScope,
    }
  }

  if (objective === 'severe-favorability') {
    const originLocation = await resolveOriginLocation({
      app: input.app,
      context: input.context,
      fallbackLocation: discoveryScope.location,
    })
    if (!originLocation) {
      return { candidates: [] as ComparisonCandidate[], discoveryScope }
    }

    const rankedTargets = await rankBroadChaseTargets({
      app: input.app,
      originLocation,
    })
    return {
      candidates: rankedTargets.candidates.slice(0, 12).map((target) => ({
        query: target.query,
        label: target.label,
        location: target.location,
        source: 'severe-discovery' as const,
        reason: target.regionLabel
          ? `Discovered from the broader ${target.regionLabel} chase corridor`
          : 'Discovered from the broader severe-weather corridor',
      })),
      discoveryScope,
    }
  }

  return { candidates: [] as ComparisonCandidate[], discoveryScope }
}

function discoverCandidatesForScope(input: {
  app: FastifyInstance
  discoveryScope: DiscoveryScope
  context?: WeatherAnswerContext
}) {
  if (input.discoveryScope.category === 'beach') {
    return discoverBeachCandidates(input.app, input.discoveryScope)
  }

  return (async () => {
    const originLocation = await resolveOriginLocation({
      app: input.app,
      context: input.context,
      fallbackLocation: input.discoveryScope.location,
    })
    if (!originLocation) {
      return [] as ComparisonCandidate[]
    }

    const rankedTargets = await rankBroadChaseTargets({
      app: input.app,
      originLocation,
    })
    return rankedTargets.candidates.slice(0, 12).map((target) => ({
      query: target.query,
      label: target.label,
      location: target.location,
      source: 'severe-discovery' as const,
      reason: target.regionLabel
        ? `Discovered from the broader ${target.regionLabel} chase corridor`
        : 'Discovered from the broader severe-weather corridor',
    }))
  })()
}

function maybePromotePreviousContextCandidates(
  namedCandidates: ComparisonCandidate[],
  previousContext: WeatherComparisonContext | null,
  userQuestion: string,
) {
  if (namedCandidates.length >= 2 || !previousContext || previousContext.candidates.length < 2) {
    return namedCandidates
  }

  const matchedPrevious = previousContext.candidates.filter((candidate) =>
    candidateMentionedInQuestion(userQuestion, candidate),
  )
  if (matchedPrevious.length > 0) {
    return previousContext.candidates
  }

  return namedCandidates
}

function deriveCandidateMode(
  classification: RequestClassification,
  namedCandidates: ComparisonCandidate[],
  discoveredCandidates: ComparisonCandidate[],
  previousContext: WeatherComparisonContext | null,
) {
  if (namedCandidates.length > 0 && discoveredCandidates.length > 0) {
    return 'mixed' as const
  }

  if (namedCandidates.length > 0) {
    return previousContext?.candidateMode === 'discovered' ? 'mixed' : 'named'
  }

  if (discoveredCandidates.length > 0) {
    return 'discovered' as const
  }

  return classification.candidateMode
}

function deriveContextCandidateMode(input: {
  classification: RequestClassification
  namedCandidates: ComparisonCandidate[]
  discoveryScope: DiscoveryScope | null
  previousContext: WeatherComparisonContext | null
}) {
  if (input.namedCandidates.length > 0) {
    return input.previousContext?.candidateMode === 'discovered'
      ? ('mixed' as const)
      : ('named' as const)
  }

  if (input.discoveryScope) {
    return 'discovered' as const
  }

  return input.classification.candidateMode
}

async function prepareComparisonRequest(input: {
  app: FastifyInstance
  classification: RequestClassification
  userQuestion: string
  context?: WeatherAnswerContext
  previousContext?: WeatherComparisonContext | null
  explicitCandidates?: CandidateInput[]
  explicitDiscoveryScope?: DiscoveryScope
  explicitOriginLocation?: WeatherComparisonToolRequest['originLocation']
  answerTone?: WeatherComparisonToolRequest['answerTone']
  displayTimezone?: string
  timeDisplay?: WeatherComparisonToolRequest['timeDisplay']
}) {
  const objective = input.classification.rankingObjective
  if (!objective || input.classification.answerMode === 'single') {
    return null
  }

  const explicitNamedInputs =
    input.explicitCandidates && input.explicitCandidates.length > 0
      ? input.explicitCandidates
      : extractNamedCandidateInputs(input.userQuestion)
  const resolvedExplicitCandidates = await resolveCandidateInputs(
    input.app,
    explicitNamedInputs,
  )
  const previousCandidates = resolvePreviousContextCandidates(
    input.userQuestion,
    input.previousContext ?? null,
  )
  const namedCandidates = maybePromotePreviousContextCandidates(
    resolvedExplicitCandidates.length > 0
      ? resolvedExplicitCandidates
      : previousCandidates,
    input.previousContext ?? null,
    input.userQuestion,
  )

  const discovered = input.explicitDiscoveryScope
    ? {
        candidates: await discoverCandidatesForScope({
          app: input.app,
          discoveryScope: input.explicitDiscoveryScope,
          context: input.context,
        }),
        discoveryScope: input.explicitDiscoveryScope,
      }
    : await discoverComparisonCandidates({
        app: input.app,
        classification: input.classification,
        userQuestion: input.userQuestion,
        context: input.context,
        previousContext: input.previousContext,
      })

  const pleasantWeatherCandidates =
    objective === 'pleasant-weather' && discovered.candidates.length === 0
      ? await discoverPleasantWeatherCandidates({
          app: input.app,
          userQuestion: input.userQuestion,
          context: input.context,
          previousContext: input.previousContext,
        })
      : []

  const candidates: ComparisonCandidate[] =
    namedCandidates.length > 0
      ? namedCandidates
      : discovered.candidates.length > 0
        ? discovered.candidates
        : pleasantWeatherCandidates
  if (candidates.length === 0) {
    return null
  }

  const analyses = await Promise.all(
    candidates.slice(0, 12).map((candidate: ComparisonCandidate) =>
      fetchCandidateAnalysis(
        input.app,
        input.classification,
        objective,
        input.userQuestion,
        candidate,
      ),
    ),
  )

  return weatherComparisonRequestSchema.parse({
    userQuestion: input.userQuestion,
    workflow: input.classification.intent,
    answerMode: input.classification.answerMode,
    candidateMode: deriveCandidateMode(
      input.classification,
      namedCandidates,
      [...discovered.candidates, ...pleasantWeatherCandidates],
      input.previousContext ?? null,
    ),
    rankLimit: input.classification.rankLimit,
    rankingObjective: objective,
    originLocation:
      input.explicitOriginLocation ??
      input.previousContext?.originLocation ??
      undefined,
    displayTimezone:
      input.displayTimezone ??
      input.context?.displayTimezone ??
      undefined,
    answerTone: input.answerTone ?? input.context?.answerTone ?? 'casual',
    timeDisplay:
      input.timeDisplay ?? input.context?.timeDisplay ?? 'user-local',
    discoveryScope: discovered.discoveryScope ?? undefined,
    candidates: analyses,
  })
}

export async function runWeatherComparison(input: {
  app: FastifyInstance
  classification: RequestClassification
  userQuestion: string
  context?: WeatherAnswerContext
  messages?: Array<any>
  explicitCandidates?: CandidateInput[]
  explicitDiscoveryScope?: DiscoveryScope
  explicitOriginLocation?: WeatherComparisonToolRequest['originLocation']
  answerTone?: WeatherComparisonToolRequest['answerTone']
  displayTimezone?: string
  timeDisplay?: WeatherComparisonToolRequest['timeDisplay']
}) {
  const previousContext = extractStoredWeatherComparisonContext(input.messages ?? [])
  const request = await prepareComparisonRequest({
    app: input.app,
    classification: input.classification,
    userQuestion: input.userQuestion,
    context: input.context,
    previousContext,
    explicitCandidates: input.explicitCandidates,
    explicitDiscoveryScope: input.explicitDiscoveryScope,
    explicitOriginLocation: input.explicitOriginLocation,
    answerTone: input.answerTone,
    displayTimezone: input.displayTimezone,
    timeDisplay: input.timeDisplay,
  })

  if (!request) {
    return null
  }

  return compareWeatherCandidatesService(input.app, request)
}

export async function buildComparisonLimitationContext(input: {
  app: FastifyInstance
  classification: RequestClassification
  userQuestion: string
  context?: WeatherAnswerContext
  messages?: Array<any>
  explicitDiscoveryScope?: DiscoveryScope
  explicitOriginLocation?: WeatherComparisonToolRequest['originLocation']
}) {
  const objective = input.classification.rankingObjective
  if (!objective || input.classification.answerMode === 'single') {
    return undefined
  }

  const previousContext = extractStoredWeatherComparisonContext(input.messages ?? [])
  const explicitNamedInputs = extractNamedCandidateInputs(input.userQuestion)
  const resolvedExplicitCandidates = await resolveCandidateInputs(
    input.app,
    explicitNamedInputs,
  )
  const previousCandidates = resolvePreviousContextCandidates(
    input.userQuestion,
    previousContext,
  )
  const namedCandidates = maybePromotePreviousContextCandidates(
    resolvedExplicitCandidates.length > 0
      ? resolvedExplicitCandidates
      : previousCandidates,
    previousContext,
    input.userQuestion,
  )

  const rawDiscoveryScope =
    input.explicitDiscoveryScope ??
    inferWeatherDiscoveryScope(
      objective,
      input.userQuestion,
      input.context,
      previousContext,
    )
  const discoveryScope = await resolveDiscoveryLocation(
    input.app,
    rawDiscoveryScope,
  )

  return weatherComparisonContextSchema.parse({
    workflow: input.classification.intent,
    answerMode: input.classification.answerMode,
    candidateMode: deriveContextCandidateMode({
      classification: input.classification,
      namedCandidates,
      discoveryScope,
      previousContext,
    }),
    rankLimit: input.classification.rankLimit,
    rankingObjective: objective,
    originLocation:
      input.explicitOriginLocation ??
      previousContext?.originLocation ??
      undefined,
    discoveryScope:
      discoveryScope ?? previousContext?.discoveryScope ?? undefined,
    candidates:
      namedCandidates.length > 0
        ? namedCandidates
        : previousCandidates,
  })
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

export function isWeatherComparisonBundle(
  value: unknown,
): value is WeatherComparisonBundle {
  return (
    isRecord(value) &&
    typeof value.bottomLine === 'string' &&
    isRecord(value.confidence) &&
    Array.isArray(value.rankedCandidates)
  )
}
