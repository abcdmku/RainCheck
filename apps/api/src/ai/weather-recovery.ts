import type { RequestClassification } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import {
  applyAnswerToneToText,
  buildComparisonLimitationText,
} from './answer-tone'
import type { WeatherAnswerContext } from './weather-context'
import { buildWeatherDerivationRequest, planWeatherDerivations } from '../weather/derivation-plan'
import {
  isBroadSevereLocatorQuestion,
  resolveOriginLocation,
  selectBroadChaseTarget,
} from '../weather/chase-targeting'
import {
  buildComparisonLimitationContext,
  isWeatherComparisonBundle,
  runWeatherComparison,
} from '../weather/comparison'
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

async function buildComparisonLimitationResult(input: {
  app: FastifyInstance
  classification: RequestClassification
  userQuestion: string
  answerTone: 'casual' | 'professional'
  context?: WeatherAnswerContext
  messages?: Array<any>
}) {
  const comparisonContext = await buildComparisonLimitationContext({
    app: input.app,
    classification: input.classification,
    userQuestion: input.userQuestion,
    context: input.context,
    messages: input.messages,
  })

  return {
    answerMode: input.classification.answerMode,
    rankingObjective:
      input.classification.rankingObjective ??
      (input.classification.intent === 'severe-weather'
        ? 'severe-favorability'
        : 'pleasant-weather'),
    rankLimit: input.classification.rankLimit,
    bottomLine: buildComparisonLimitationText(
      input.classification,
      input.answerTone,
    ),
    confidence: {
      level: 'low' as const,
      reason: applyAnswerToneToText(
        'The comparison still needs a usable search area or named places.',
        input.answerTone,
      ),
    },
    whyRainCheckThinksThat: applyAnswerToneToText(
      'The ranking can only run after at least one place or search area resolves cleanly.',
      input.answerTone,
    ),
    sharedUncertainty: applyAnswerToneToText(
      `The current request still needs a clear region or a clearer set of places for "${input.userQuestion.trim()}".`,
      input.answerTone,
    ),
    rankedCandidates: [],
    recommendedCards: [],
    citations: [],
    comparisonContext,
  }
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

function defaultLocationQueryFromContext(context?: WeatherAnswerContext) {
  const locationHint = context?.locationHint
  if (!locationHint) {
    return null
  }

  if (
    typeof locationHint.latitude === 'number' &&
    Number.isFinite(locationHint.latitude) &&
    typeof locationHint.longitude === 'number' &&
    Number.isFinite(locationHint.longitude)
  ) {
    return `${locationHint.latitude}, ${locationHint.longitude}`
  }

  const candidates = [
    typeof locationHint.name === 'string' ? locationHint.name.trim() : '',
    typeof locationHint.label === 'string' ? locationHint.label.trim() : '',
  ]

  return candidates.find((candidate) => candidate.length > 0) ?? null
}

function prefersNationalSevereContext(
  classification: RequestClassification,
  userQuestion: string,
) {
  return (
    classification.intent === 'severe-weather' &&
    /\bspc\b|\bconvective outlook\b|\bday\s*[1-9](?:\s*(?:and|&|-)\s*[1-9])?\b/i.test(
      userQuestion,
    )
  )
}

function candidateLocationQueries(
  classification: RequestClassification,
  userQuestion: string,
  toolResults: Array<WeatherRecoveryToolResult>,
  context?: WeatherAnswerContext,
) {
  const inferredLocation = inferLocationQueryFromQuestion(userQuestion)
  const broadRecoveredLocation = broadenRecoveredLocationQuery(toolResults)
  const recoveredLocation = latestRecoveredLocationQuery(toolResults)
  const defaultLocation = defaultLocationQueryFromContext(context)
  const broadSevereLocator = isBroadSevereLocatorQuestion(
    classification,
    userQuestion,
  )
  const candidates = broadSevereLocator
    ? [
        inferredLocation,
        broadRecoveredLocation,
        defaultLocation,
        recoveredLocation,
        classification.locationRequired ? userQuestion : null,
      ]
    : [
        recoveredLocation,
        inferredLocation,
        defaultLocation,
        classification.locationRequired ? userQuestion : null,
        classification.locationRequired
          ? prefersNationalSevereContext(classification, userQuestion)
            ? 'United States'
            : null
          : 'United States',
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

function stripTerminalPunctuation(value: string) {
  return normalizeTimingLanguage(value)
    .trim()
    .replace(/[.!?;:]+$/, '')
    .trim()
}

function terminalPunctuation(value: string) {
  const match = normalizeTimingLanguage(value).trim().match(/[.!?]+$/)
  if (!match) {
    return '.'
  }

  if (match[0].includes('?')) {
    return '?'
  }

  if (match[0].includes('!')) {
    return '!'
  }

  return '.'
}

function normalizeSentence(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const body = stripTerminalPunctuation(value)
  if (!body) {
    return null
  }

  return `${body}${terminalPunctuation(value)}`
}

function lowerSentenceStart(value: string) {
  if (!value) {
    return value
  }

  if (/^[A-Z]{2,}\b/.test(value)) {
    return value
  }

  return value.charAt(0).toLowerCase() + value.slice(1)
}

function confidenceLevelValue(result: Record<string, any>) {
  const confidence = result.confidence
  return isRecord(confidence) && typeof confidence.level === 'string'
    ? confidence.level
    : typeof confidence === 'string'
      ? confidence
      : null
}

function confidenceReasonValue(result: Record<string, any>) {
  const confidence = result.confidence
  return isRecord(confidence) && typeof confidence.reason === 'string'
    ? confidence.reason
    : null
}

function isGenericConfidenceReason(reason: string) {
  return (
    /\bconfidence reflects\b/i.test(reason) ||
    /\bdirect candidate evidence\b/i.test(reason) ||
    /\bleading candidate separates\b/i.test(reason) ||
    /\bweighted strength\b/i.test(reason) ||
    /\bleading evidence\b/i.test(reason) ||
    /\bunresolved conflicts\b/i.test(reason)
  )
}

function readableConfidenceReason(result: Record<string, any>) {
  const reason = confidenceReasonValue(result)
  if (!reason || isGenericConfidenceReason(reason)) {
    return null
  }

  return lowerSentenceStart(stripTerminalPunctuation(reason))
}

function hasConditionalLanguage(...values: Array<unknown>) {
  return values.some(
    (value) =>
      typeof value === 'string' &&
      /\bconditional\b|\bdepends on\b|\bstill depends\b|\bcan still shift\b|\bmay still shift\b|\bmight still shift\b|\bnot locked\b|\bstill too close\b|\bsensitive to\b/i.test(
        value,
      ),
  )
}

function comparisonGap(result: Record<string, any>) {
  const ranked = Array.isArray(result.rankedCandidates)
    ? result.rankedCandidates
    : []
  const winner = ranked[0]
  const runnerUp = ranked[1]
  if (
    !winner ||
    !runnerUp ||
    typeof winner.score !== 'number' ||
    typeof runnerUp.score !== 'number'
  ) {
    return null
  }

  return Math.max(0, winner.score - runnerUp.score)
}

function comparisonConfidenceSentence(result: Record<string, any>) {
  const level = confidenceLevelValue(result)
  const reason = readableConfidenceReason(result)
  const gap = comparisonGap(result)

  if (level === 'low') {
    return reason
      ? `Confidence is still low because ${reason}.`
      : 'Confidence is still low.'
  }

  if (typeof gap === 'number' && (gap < 0.08 || (level === 'medium' && gap < 0.14))) {
    return 'It is still a fairly close call.'
  }

  return null
}

function conclusionConfidenceSentence(result: Record<string, any>) {
  const level = confidenceLevelValue(result)
  const reason = readableConfidenceReason(result)
  const conditional = hasConditionalLanguage(
    result.bottomLine,
    result.mostLikelyScenario,
    ...(Array.isArray(result.keyConflicts) ? result.keyConflicts : []),
    ...(Array.isArray(result.bustRisks) ? result.bustRisks : []),
  )

  if (level === 'low') {
    return reason
      ? `Confidence is still low because ${reason}.`
      : 'Confidence is still low.'
  }

  if (conditional) {
    return reason
      ? `It is still a conditional call because ${reason}.`
      : 'It is still a conditional call.'
  }

  return null
}

function uncertaintySentence(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const detail = stripTerminalPunctuation(value)
  if (!detail) {
    return null
  }

  if (
    /\bdepends\b|\bdependent\b|\bconditional\b|\buncertain\b|\bsensitive\b|\bcan\b|\bcould\b|\bmay\b|\bmight\b|\bshift\b|\bwobble\b|\bchange\b|\bmove\b/i.test(
      detail,
    )
  ) {
    return `${detail}.`
  }

  return `The main thing that could still shift this is ${lowerSentenceStart(detail)}.`
}

function joinSentences(parts: Array<string | null | undefined>) {
  return parts
    .map((part) => normalizeSentence(part))
    .filter((part): part is string => Boolean(part))
    .join(' ')
}

function pushUniqueSection(
  sections: string[],
  candidate: string | null | undefined,
) {
  const normalized = normalizeSentence(candidate)
  if (!normalized) {
    return
  }

  if (sections.some((existing) => sectionsMostlyOverlap(normalized, existing))) {
    return
  }

  sections.push(normalized)
}

function firstString(
  value: unknown,
): string | null {
  return typeof value === 'string' && value.trim() ? value : null
}

function firstListString(value: unknown) {
  return Array.isArray(value)
    ? (value.find(
        (item): item is string =>
          typeof item === 'string' && item.trim().length > 0,
      ) ??
      null)
    : null
}

function comparisonSupportSentence(result: Record<string, any>) {
  const winner = Array.isArray(result.rankedCandidates)
    ? result.rankedCandidates[0]
    : null

  return (
    firstString(winner?.why) ??
    firstString(winner?.summary) ??
    firstString(result.whyRainCheckThinksThat)
  )
}

function conclusionSupportSentence(result: Record<string, any>) {
  return (
    firstString(result.mostLikelyScenario) ??
    firstListString(result.keySupportingSignals) ??
    firstString(result.agreementSummary)
  )
}

function artifactSectionsFromConclusion(result: Record<string, any>) {
  const sections: string[] = []
  pushUniqueSection(sections, result.bottomLine)
  pushUniqueSection(sections, conclusionSupportSentence(result))
  pushUniqueSection(
    sections,
    uncertaintySentence(
      firstListString(result.keyConflicts) ?? firstListString(result.bustRisks),
    ),
  )

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
  answerTone: 'casual' | 'professional' = 'casual',
) {
  const comparisonResult = [...toolResults]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isWeatherComparisonBundle)

  if (comparisonResult) {
    if (
      !Array.isArray(comparisonResult.rankedCandidates) ||
      comparisonResult.rankedCandidates.length === 0
    ) {
      return applyAnswerToneToText(
        normalizeTimingLanguage(
          joinSentences([comparisonResult.bottomLine]),
        ),
        answerTone,
      )
    }

    const sections: string[] = []
    pushUniqueSection(sections, comparisonResult.bottomLine)
    pushUniqueSection(sections, comparisonConfidenceSentence(comparisonResult))
    pushUniqueSection(sections, comparisonSupportSentence(comparisonResult))
    pushUniqueSection(
      sections,
      uncertaintySentence(
        firstString(comparisonResult.sharedUncertainty) ??
          firstListString(comparisonResult.rankedCandidates[0]?.conflicts),
      ),
    )

    return applyAnswerToneToText(
      normalizeTimingLanguage(joinSentences(sections)),
      answerTone,
    )
  }

  const conclusionResult = [...toolResults]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isWeatherConclusion)

  if (conclusionResult) {
    const sections: string[] = []
    pushUniqueSection(sections, conclusionResult.bottomLine)
    pushUniqueSection(sections, conclusionConfidenceSentence(conclusionResult))
    pushUniqueSection(sections, conclusionSupportSentence(conclusionResult))
    pushUniqueSection(
      sections,
      uncertaintySentence(
        firstListString(conclusionResult.keyConflicts) ??
          firstListString(conclusionResult.bustRisks),
      ),
    )

    return applyAnswerToneToText(
      normalizeTimingLanguage(joinSentences(sections)),
      answerTone,
    )
  }

  const derivationResult = [...toolResults]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isDerivationBundle)

  if (derivationResult) {
    const sections: string[] = []
    pushUniqueSection(sections, derivationResult.agreementSummary)
    pushUniqueSection(
      sections,
      uncertaintySentence(firstListString(derivationResult.keyConflicts)),
    )

    return applyAnswerToneToText(
      normalizeTimingLanguage(joinSentences(sections)),
      answerTone,
    )
  }

  const latestWeatherResult = [...toolResults]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isWeatherEnvelope)

  if (latestWeatherResult) {
    return applyAnswerToneToText(
      normalizeTimingLanguage(latestWeatherResult.summary),
      answerTone,
    )
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
    timezone:
      typeof location.timezone === 'string' ? location.timezone : undefined,
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
  locationQuery?: string
  location?: ReturnType<typeof buildResolvedLocation> | null
}) {
  let location = input.location ?? null
  if (!location && input.locationQuery) {
    try {
      location = buildResolvedLocation(
        await geocodeQuery(input.app, input.locationQuery),
      )
    } catch {
      return { location: null, results: [] as Array<WeatherRecoveryToolResult> }
    }
  }

  if (!location) {
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
  context?: WeatherAnswerContext,
  messages?: Array<any>,
) {
  if (!userQuestion.trim()) {
    return []
  }

  const answerTone = context?.answerTone ?? 'casual'
  const existingToolNames = new Set(
    toolResults.map((toolResult) => toolResult.toolName),
  )
  if (classification.answerMode !== 'single') {
    if (existingToolNames.has('compare_weather_candidates')) {
      return []
    }

    const comparisonResult =
      (await runWeatherComparison({
        app,
        classification,
        userQuestion,
        context,
        messages,
      })) ??
      (await buildComparisonLimitationResult({
        app,
        classification,
        userQuestion,
        answerTone,
        context,
        messages,
      }))

    return [
      {
        toolCallId: 'recovery-compare_weather_candidates',
        toolName: 'compare_weather_candidates',
        input: {
          userQuestion,
          workflow: classification.intent,
          answerMode: classification.answerMode,
          candidateMode: classification.candidateMode,
          rankLimit: classification.rankLimit,
          rankingObjective: classification.rankingObjective,
          answerTone,
        },
        result: comparisonResult,
      },
    ]
  }

  const recovered: Array<WeatherRecoveryToolResult> = []
  const locationQueries = candidateLocationQueries(
    classification,
    userQuestion,
    toolResults,
    context,
  )

  if (locationQueries.length === 0) {
    return []
  }

  let location: ReturnType<typeof buildResolvedLocation> | null = null
  let results: Array<WeatherRecoveryToolResult> = []
  let locationQuery: string | null = null
  let originLocation: ReturnType<typeof buildResolvedLocation> | null = null
  let selectedTarget:
    | {
        query: string
        label: string
        location: ReturnType<typeof buildResolvedLocation>
        regionLabel?: string
        startLabel?: string
        stopLabel?: string
        travelHours?: number
        corridorHours?: number
        withinNearbyRadius?: boolean
        supportScore?: number
      }
    | null = null
  let nightfall:
    | {
        event: 'civil-dusk' | 'sunset'
        occursAt: string
      }
    | null = null

  if (isBroadSevereLocatorQuestion(classification, userQuestion)) {
    const resolvedOriginLocation = await resolveOriginLocation({
      app,
      context,
      fallbackLocation: latestRecoveredLocation(toolResults)
        ? buildResolvedLocation(latestRecoveredLocation(toolResults)!)
        : null,
    })
    originLocation = resolvedOriginLocation
      ? buildResolvedLocation(resolvedOriginLocation as any)
      : null

    if (originLocation) {
      try {
        const chaseTarget = await selectBroadChaseTarget({
          app,
          originLocation,
          referenceTime: new Date().toISOString(),
        })
        if (chaseTarget) {
          location = buildResolvedLocation(chaseTarget.selectedTarget.location)
          locationQuery = chaseTarget.selectedTarget.query
          selectedTarget = {
            ...chaseTarget.selectedTarget,
            location,
          }
          nightfall = chaseTarget.nightfall

          if (!existingToolNames.has('get_severe_context')) {
            recovered.push({
              toolCallId: 'recovery-get_severe_context',
              toolName: 'get_severe_context',
              input: {
                locationQuery: chaseTarget.severeContextQuery,
              },
              result: chaseTarget.severeContext,
            })
            existingToolNames.add('get_severe_context')
          }

          const recoveredDerivations = await buildRecoveryDerivationResults({
            app,
            classification,
            userQuestion,
            locationQuery,
            location,
          })

          results = recoveredDerivations.results
        }
      } catch {
        // Best-effort recovery only.
      }
    }
  }

  if (!location) {
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
          originLocation: originLocation ?? undefined,
          displayTimezone: context?.displayTimezone,
          answerTone,
          timeDisplay: context?.timeDisplay ?? 'user-local',
          selectedTarget: selectedTarget ?? undefined,
          nightfall: nightfall ?? undefined,
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
