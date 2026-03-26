import type { RequestClassification } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { buildWeatherDerivationRequest, planWeatherDerivations } from '../weather/derivation-plan'
import { geocodeQuery } from '../weather/geocode'
import {
  deriveGlobalWeather,
  deriveHydrologyWeather,
  deriveRadarNowcast,
  deriveSatelliteWeather,
  deriveShortRangeWeather,
  generateArtifact,
  synthesizeWeatherConclusion,
} from '../weather/service-client'
import { normalizeTimingLanguage } from '../weather/timing-language'

export type WeatherRecoveryToolResult = {
  toolCallId: string
  toolName: string
  input?: unknown
  result: unknown
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isWeatherEnvelope(value: unknown): value is Record<string, any> {
  return (
    isRecord(value) &&
    typeof value.summary === 'string' &&
    isRecord(value.location) &&
    isRecord(value.normalizedForecast)
  )
}

function isDerivationBundle(value: unknown): value is Record<string, any> {
  return (
    isRecord(value) &&
    typeof value.agreementSummary === 'string' &&
    Array.isArray(value.evidenceProducts)
  )
}

function isWeatherConclusion(value: unknown): value is Record<string, any> {
  return (
    isRecord(value) &&
    typeof value.bottomLine === 'string' &&
    isRecord(value.confidence)
  )
}

function isResolvedLocation(value: unknown): value is Record<string, any> {
  return (
    isRecord(value) &&
    typeof value.query === 'string' &&
    typeof value.name === 'string' &&
    typeof value.latitude === 'number' &&
    typeof value.longitude === 'number'
  )
}

function dedupeToolResults(toolResults: Array<WeatherRecoveryToolResult>) {
  const deduped = new Map<string, WeatherRecoveryToolResult>()

  for (const toolResult of toolResults) {
    deduped.set(toolResult.toolName, toolResult)
  }

  return [...deduped.values()]
}

function latestRecoveredLocationQuery(
  toolResults: Array<WeatherRecoveryToolResult>,
) {
  const location = latestRecoveredLocation(toolResults)
  if (!location) {
    return null
  }

  const query = location.query?.trim()
  if (query) {
    return query
  }

  const name = location.name?.trim()
  if (name) {
    return name
  }

  return null
}

function latestRecoveredLocation(
  toolResults: Array<WeatherRecoveryToolResult>,
) {
  for (const toolResult of [...toolResults].reverse()) {
    if (
      toolResult.toolName === 'resolve_location' &&
      isResolvedLocation(toolResult.result)
    ) {
      return toolResult.result
    }

    if (!isWeatherEnvelope(toolResult.result)) {
      continue
    }

    if (isResolvedLocation(toolResult.result.location)) {
      return toolResult.result.location
    }
  }

  return null
}

function broadenRecoveredLocationQuery(
  toolResults: Array<WeatherRecoveryToolResult>,
) {
  const location = latestRecoveredLocation(toolResults)
  if (!location) {
    return null
  }

  const region = typeof location.region === 'string' ? location.region.trim() : ''
  if (region) {
    return region
  }

  const country =
    typeof location.country === 'string' ? location.country.trim() : ''
  if (country) {
    return country
  }

  return null
}

function inferLocationQueryFromQuestion(userQuestion: string) {
  const coordinateMatch = userQuestion.match(
    /(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/,
  )
  if (coordinateMatch) {
    return `${coordinateMatch[1]}, ${coordinateMatch[2]}`
  }

  const locationMatch = userQuestion.match(
    /\b(?:in|near|around|for|across)\s+([a-z0-9 .,'-]+?)(?=\s+(?:what|what's|whats|where|where's|wheres|when|when's|whens|which|should|could|would|will|do|does|did|because|according|currently|tonight|today|tomorrow|this|other|storms?|tornado(?:s|es)?|hail|wind)\b|[?.!,]|$)/i,
  )
  return locationMatch?.[1]?.trim() ?? null
}

function isBroadSevereLocatorQuestion(
  classification: RequestClassification,
  userQuestion: string,
) {
  if (classification.intent !== 'severe-weather' || classification.locationRequired) {
    return false
  }

  return /\b(where (?:are|will|is)|best (?:storms?|spot|place|area)|start chasing|start the chase|where should i start|what time and where|where should i go|where should i be|follow these storms)\b/i.test(
    userQuestion,
  )
}

function candidateLocationQueries(
  classification: RequestClassification,
  userQuestion: string,
  toolResults: Array<WeatherRecoveryToolResult>,
) {
  const inferredLocation = inferLocationQueryFromQuestion(userQuestion)
  const broadRecoveredLocation = broadenRecoveredLocationQuery(toolResults)
  const recoveredLocation = latestRecoveredLocationQuery(toolResults)
  const broadSevereLocator = isBroadSevereLocatorQuestion(
    classification,
    userQuestion,
  )
  const candidates = broadSevereLocator
    ? [
        inferredLocation,
        broadRecoveredLocation,
        classification.locationRequired ? null : 'United States',
        recoveredLocation,
        classification.locationRequired ? userQuestion : null,
      ]
    : [
        recoveredLocation,
        inferredLocation,
        classification.locationRequired ? userQuestion : null,
        classification.locationRequired ? null : 'United States',
      ]

  const seen = new Set<string>()
  return candidates.filter((candidate): candidate is string => {
    const normalized = candidate?.trim()
    if (!normalized) {
      return false
    }

    const key = normalized.toLowerCase()
    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function confidenceSummary(result: Record<string, any>) {
  const confidence = result.confidence
  if (isRecord(confidence) && typeof confidence.level === 'string') {
    return `Confidence: ${confidence.level}.`
  }

  if (typeof confidence === 'string') {
    return `Confidence: ${confidence}.`
  }

  return null
}

const SECTION_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'area',
  'be',
  'during',
  'for',
  'from',
  'if',
  'in',
  'into',
  'is',
  'main',
  'near',
  'of',
  'on',
  'or',
  'stay',
  'still',
  'the',
  'their',
  'there',
  'this',
  'to',
  'window',
  'with',
])

function normalizeSectionText(value: string) {
  return normalizeTimingLanguage(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sectionTokens(value: string) {
  return new Set(
    normalizeSectionText(value)
      .split(' ')
      .filter(
        (token) => token.length > 2 && !SECTION_STOP_WORDS.has(token),
      ),
  )
}

function sectionsMostlyOverlap(candidate: string, existing: string) {
  const candidateNormalized = normalizeSectionText(candidate)
  const existingNormalized = normalizeSectionText(existing)

  if (
    !candidateNormalized ||
    !existingNormalized ||
    candidateNormalized === existingNormalized ||
    candidateNormalized.includes(existingNormalized) ||
    existingNormalized.includes(candidateNormalized)
  ) {
    return true
  }

  const candidateTokens = sectionTokens(candidate)
  const existingTokens = sectionTokens(existing)
  if (candidateTokens.size === 0 || existingTokens.size === 0) {
    return false
  }

  let overlap = 0
  for (const token of candidateTokens) {
    if (existingTokens.has(token)) {
      overlap += 1
    }
  }

  return overlap / Math.min(candidateTokens.size, existingTokens.size) >= 0.5
}

function pushUniqueSection(
  sections: string[],
  candidate: string | null | undefined,
) {
  if (typeof candidate !== 'string') {
    return
  }

  const normalized = normalizeTimingLanguage(candidate).trim()
  if (!normalized) {
    return
  }

  if (sections.some((existing) => sectionsMostlyOverlap(normalized, existing))) {
    return
  }

  sections.push(normalized)
}

function conclusionSections(
  result: Record<string, any>,
  options?: { includeAgreement?: boolean },
) {
  const sections: string[] = []
  const keyConflicts = Array.isArray(result.keyConflicts)
    ? result.keyConflicts.filter((value): value is string => typeof value === 'string')
    : []
  const bustRisks = Array.isArray(result.bustRisks)
    ? result.bustRisks.filter((value): value is string => typeof value === 'string')
    : []

  pushUniqueSection(sections, result.bottomLine)
  pushUniqueSection(
    sections,
    typeof result.mostLikelyScenario === 'string'
      ? `Most likely: ${result.mostLikelyScenario}`
      : null,
  )
  pushUniqueSection(sections, confidenceSummary(result))
  if (options?.includeAgreement) {
    pushUniqueSection(
      sections,
      typeof result.agreementSummary === 'string'
        ? `Agreement: ${result.agreementSummary}.`
        : null,
    )
  }
  pushUniqueSection(
    sections,
    keyConflicts.length > 0
      ? `Main uncertainty: ${keyConflicts[0]}.`
      : null,
  )
  pushUniqueSection(
    sections,
    bustRisks.length > 0
      ? `Bust risk: ${bustRisks[0]}.`
      : null,
  )

  return sections
}

function conflictSummary(result: Record<string, any>) {
  const conflicts = Array.isArray(result.keyConflicts)
    ? result.keyConflicts.filter((value): value is string => typeof value === 'string')
    : []
  if (conflicts.length > 0) {
    return `Main uncertainty: ${normalizeTimingLanguage(conflicts[0])}.`
  }

  const bustRisks = Array.isArray(result.bustRisks)
    ? result.bustRisks.filter((value): value is string => typeof value === 'string')
    : []
  if (bustRisks.length > 0) {
    return `Bust risk: ${normalizeTimingLanguage(bustRisks[0])}.`
  }

  return null
}

function artifactSectionsFromConclusion(result: Record<string, any>) {
  const sections = [
    ...conclusionSections(result, { includeAgreement: false }),
    conflictSummary(result),
  ].filter((value, index, values): value is string => {
    if (!value) {
      return false
    }

    return values.findIndex((candidate) => candidate === value) === index
  })

  return sections.length > 0 ? sections : ['Supported weather visual summary.']
}

function hasArtifactPayload(toolResults: Array<WeatherRecoveryToolResult>) {
  return toolResults.some((toolResult) => {
    const result = toolResult.result
    return (
      (isRecord(result) &&
        typeof result.artifactId === 'string' &&
        typeof result.href === 'string') ||
      (isRecord(result) &&
        Array.isArray(result.artifacts) &&
        result.artifacts.length > 0) ||
      (isRecord(result) &&
        Array.isArray(result.recommendedArtifacts) &&
        result.recommendedArtifacts.length > 0)
    )
  })
}

function buildWeatherFallbackText(
  toolResults: Array<WeatherRecoveryToolResult>,
) {
  const conclusionResult = [...toolResults]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isWeatherConclusion)

  if (conclusionResult) {
    const summaryText = conclusionSections(conclusionResult, {
      includeAgreement: false,
    }).join(' ')

    return normalizeTimingLanguage(summaryText)
  }

  const derivationResult = [...toolResults]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isDerivationBundle)

  if (derivationResult) {
    return normalizeTimingLanguage(
      [
        derivationResult.agreementSummary,
        Array.isArray(derivationResult.keyConflicts) &&
        derivationResult.keyConflicts.length > 0
          ? `Main uncertainty: ${derivationResult.keyConflicts[0]}.`
          : null,
      ]
        .filter(Boolean)
        .join(' '),
    )
  }

  const latestWeatherResult = [...toolResults]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isWeatherEnvelope)

  if (latestWeatherResult) {
    return normalizeTimingLanguage(latestWeatherResult.summary)
  }

  return null
}

function evidenceProductsFromToolResults(
  toolResults: Array<WeatherRecoveryToolResult>,
) {
  return toolResults.flatMap((toolResult) => {
    const result = toolResult.result
    if (!isRecord(result) || !Array.isArray(result.evidenceProducts)) {
      return []
    }

    return result.evidenceProducts
  })
}

function buildResolvedLocation(location: Record<string, any>) {
  return {
    query: String(location.query),
    name: String(location.name),
    latitude: Number(location.latitude),
    longitude: Number(location.longitude),
    region:
      typeof location.region === 'string' ? location.region : undefined,
    country:
      typeof location.country === 'string' ? location.country : undefined,
    resolvedBy:
      typeof location.resolvedBy === 'string'
        ? location.resolvedBy
        : 'geocoded',
  }
}

async function buildRecoveryDerivationResults(input: {
  app: FastifyInstance
  classification: RequestClassification
  userQuestion: string
  locationQuery: string
}) {
  let location: ReturnType<typeof buildResolvedLocation> | null = null
  try {
    location = buildResolvedLocation(
      await geocodeQuery(input.app, input.locationQuery),
    )
  } catch {
    return { location: null, results: [] as Array<WeatherRecoveryToolResult> }
  }

  const endpoints = planWeatherDerivations(input.classification)
  const derivedRequests = endpoints.map((endpoint) =>
      buildWeatherDerivationRequest({
        classification: input.classification,
        endpoint,
        location,
        userQuestion: input.userQuestion,
      }),
  )

  const results: Array<WeatherRecoveryToolResult> = []

  for (let index = 0; index < derivedRequests.length; index += 1) {
    const endpoint = endpoints[index]
    if (!endpoint) {
      continue
    }

    try {
      const request = derivedRequests[index]
      let result: unknown = null

      switch (endpoint) {
        case 'short-range':
          result = await deriveShortRangeWeather(input.app, request as any)
          break
        case 'global':
          result = await deriveGlobalWeather(input.app, request as any)
          break
        case 'radar-nowcast':
          result = await deriveRadarNowcast(input.app, request as any)
          break
        case 'satellite':
          result = await deriveSatelliteWeather(input.app, request as any)
          break
        case 'hydrology':
          result = await deriveHydrologyWeather(input.app, request as any)
          break
      }

      results.push({
        toolCallId: `recovery-${endpoint}`,
        toolName:
          endpoint === 'short-range'
            ? 'derive_short_range_weather'
            : endpoint === 'global'
              ? 'derive_global_weather'
              : endpoint === 'radar-nowcast'
                ? 'derive_radar_nowcast'
                : endpoint === 'satellite'
                  ? 'derive_satellite_weather'
                  : 'derive_hydrology_weather',
        input: request,
        result,
      })
    } catch {
      // Best-effort recovery only.
    }
  }

  return { location, results }
}

export async function recoverWeatherToolResults(
  app: FastifyInstance,
  classification: RequestClassification,
  userQuestion: string,
  toolResults: Array<WeatherRecoveryToolResult>,
) {
  if (!userQuestion.trim()) {
    return []
  }

  const recovered: Array<WeatherRecoveryToolResult> = []
  const existingToolNames = new Set(
    toolResults.map((toolResult) => toolResult.toolName),
  )
  const locationQueries = candidateLocationQueries(
    classification,
    userQuestion,
    toolResults,
  )

  if (locationQueries.length === 0) {
    return []
  }

  let location: ReturnType<typeof buildResolvedLocation> | null = null
  let results: Array<WeatherRecoveryToolResult> = []
  let locationQuery: string | null = null

  for (const candidate of locationQueries) {
    const recoveredDerivations = await buildRecoveryDerivationResults({
      app,
      classification,
      userQuestion,
      locationQuery: candidate,
    })

    if (!recoveredDerivations.location) {
      continue
    }

    location = recoveredDerivations.location
    results = recoveredDerivations.results
    locationQuery = candidate
    break
  }

  if (!location) {
    return []
  }

  for (const result of results) {
    if (existingToolNames.has(result.toolName)) {
      continue
    }

    recovered.push(result)
    existingToolNames.add(result.toolName)
  }

  const combinedToolResults = dedupeToolResults([...toolResults, ...recovered])
  const existingSynthesis = combinedToolResults.find(
    (toolResult) => toolResult.toolName === 'synthesize_weather_conclusion',
  )

  if (!existingSynthesis) {
    const supportingBundles = combinedToolResults
      .map((toolResult) => toolResult.result)
      .filter(isDerivationBundle)

    if (supportingBundles.length > 0) {
      try {
        const synthesisRequest = {
          userQuestion,
          workflow: classification.intent,
          region: {
            type: 'point' as const,
            location,
            radiusKm: 180,
          },
          timeWindow: {
            start: new Date().toISOString(),
            end: new Date(
              Date.now() +
                Math.max(1, classification.timeHorizonHours || 6) *
                  60 *
                  60 *
                  1000,
            ).toISOString(),
            referenceTime: new Date().toISOString(),
            recentHours: Math.min(classification.timeHorizonHours || 6, 72),
          },
          chaseGuidanceLevel: classification.chaseGuidanceLevel,
          evidenceProducts: evidenceProductsFromToolResults(combinedToolResults),
          supportingBundles,
        }

        recovered.push({
          toolCallId: 'recovery-synthesize_weather_conclusion',
          toolName: 'synthesize_weather_conclusion',
          input: synthesisRequest,
          result: await synthesizeWeatherConclusion(app, synthesisRequest),
        })
      } catch {
        // Recovery synthesis is best-effort only.
      }
    }
  }

  const toolResultsWithSynthesis = dedupeToolResults([
    ...toolResults,
    ...recovered,
  ])
  const synthesizedResult = [...toolResultsWithSynthesis]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isWeatherConclusion)

  if (
    classification.needsArtifact &&
    locationQuery &&
    synthesizedResult &&
    !hasArtifactPayload(toolResultsWithSynthesis)
  ) {
    try {
      const artifact = await generateArtifact(app, {
        artifactType: 'brief-report',
        locationQuery,
        prompt: `Supported weather visual summary for ${locationQuery}`,
        sections: artifactSectionsFromConclusion(synthesizedResult),
      })
      recovered.push({
        toolCallId: 'recovery-generate_weather_artifact',
        toolName: 'generate_weather_artifact',
        input: {
          artifactType: 'brief-report',
          locationQuery,
        },
        result: artifact,
      })
    } catch {
      // Artifact recovery is best-effort only.
    }
  }

  return recovered
}

export { buildWeatherFallbackText }
