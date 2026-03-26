import type { RequestClassification } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import {
  getPrecipFloodContext,
  getRadarSatelliteNowcast,
  getSevereContext,
} from '../weather/domain-tools'
import { getGlobalGuidance, getShortRangeGuidance } from '../weather/models'
import type { WeatherEnvelope } from '../weather/runtime'
import { generateArtifact } from '../weather/service-client'
import { synthesizeWeatherConclusion } from '../weather/synthesis'
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

function isWeatherConclusion(value: unknown): value is Record<string, any> {
  return (
    isRecord(value) &&
    typeof value.bottomLine === 'string' &&
    value.confidence != null
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

function latestToolResult(
  toolResults: Array<WeatherRecoveryToolResult>,
  toolName: string,
) {
  return [...toolResults]
    .reverse()
    .find((toolResult) => toolResult.toolName === toolName)
}

function latestEnvelope(
  toolResults: Array<WeatherRecoveryToolResult>,
  toolName: string,
) {
  const result = latestToolResult(toolResults, toolName)?.result
  return isWeatherEnvelope(result)
    ? (result as WeatherEnvelope<any>)
    : undefined
}

function dedupeToolResults(toolResults: Array<WeatherRecoveryToolResult>) {
  const deduped = new Map<string, WeatherRecoveryToolResult>()

  for (const toolResult of toolResults) {
    deduped.set(toolResult.toolName, toolResult)
  }

  return [...deduped.values()]
}

async function maybeRecoverTool(
  recovered: Array<WeatherRecoveryToolResult>,
  existingToolNames: Set<string>,
  toolName: string,
  input: Record<string, unknown>,
  handler: () => Promise<unknown>,
) {
  if (existingToolNames.has(toolName)) {
    return
  }

  try {
    const result = await handler()
    recovered.push({
      toolCallId: `recovery-${toolName}`,
      toolName,
      input,
      result,
    })
    existingToolNames.add(toolName)
  } catch {
    // Best-effort recovery only; partial context is still better than no answer.
  }
}

function formatConfidence(confidence: unknown) {
  if (typeof confidence === 'string') {
    return {
      level: confidence.toLowerCase(),
      reason: null,
    }
  }

  if (
    isRecord(confidence) &&
    typeof confidence.level === 'string' &&
    typeof confidence.reason === 'string'
  ) {
    return {
      level: confidence.level.toLowerCase(),
      reason: confidence.reason,
    }
  }

  return null
}

function lowerFirst(value: string) {
  if (!value) {
    return value
  }

  if (/^[A-Z]{2,}\b/.test(value)) {
    return value
  }

  return value.charAt(0).toLowerCase() + value.slice(1)
}

function formatMostLikelyScenario(value: string) {
  const trimmed = normalizeTimingLanguage(value).trim()
  if (!trimmed) {
    return null
  }

  if (/^(most likely|the most likely)\b/i.test(trimmed)) {
    return trimmed
  }

  return `Most likely, ${lowerFirst(trimmed)}`
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
        result.artifacts.length > 0)
    )
  })
}

function artifactSectionsFromConclusion(result: Record<string, any>) {
  const sections = [
    typeof result.bottomLine === 'string'
      ? normalizeTimingLanguage(result.bottomLine)
      : null,
    typeof result.mostLikelyScenario === 'string'
      ? formatMostLikelyScenario(result.mostLikelyScenario)
      : null,
    isRecord(result.confidence) && typeof result.confidence.reason === 'string'
      ? `Confidence: ${normalizeTimingLanguage(result.confidence.reason)}`
      : null,
    Array.isArray(result.conflicts) && typeof result.conflicts[0] === 'string'
      ? `Main uncertainty: ${normalizeTimingLanguage(result.conflicts[0])}`
      : null,
  ].filter((value): value is string => Boolean(value))

  return sections.length > 0 ? sections : ['Supported weather visual summary.']
}

function latestRecoveredLocationQuery(
  toolResults: Array<WeatherRecoveryToolResult>,
) {
  for (const toolResult of [...toolResults].reverse()) {
    if (
      toolResult.toolName === 'resolve_location' &&
      isResolvedLocation(toolResult.result)
    ) {
      const query = toolResult.result.query?.trim()
      if (query) {
        return query
      }

      const name = toolResult.result.name?.trim()
      if (name) {
        return name
      }
    }

    if (!isWeatherEnvelope(toolResult.result)) {
      continue
    }

    const query = toolResult.result.location?.query?.trim()
    if (query) {
      return query
    }

    const name = toolResult.result.location?.name?.trim()
    if (name) {
      return name
    }
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
    /\b(?:in|near|around|for|across)\s+([a-z0-9 .,'-]+?)(?=\s+(?:what|where|when|which|should|could|would|will|do|does|did|because|according|currently|tonight|today|tomorrow|this|other|models|storms?|tornado(?:s|es)?|hail|wind)\b|[?.!,]|$)/i,
  )
  return locationMatch?.[1]?.trim() ?? null
}

export function buildWeatherFallbackText(
  toolResults: Array<WeatherRecoveryToolResult>,
) {
  const conclusionResult = [...toolResults]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isWeatherConclusion)

  if (conclusionResult) {
    const confidence = formatConfidence(conclusionResult.confidence)
    const keySignals = Array.isArray(conclusionResult.keySignals)
      ? conclusionResult.keySignals.filter(
          (value): value is string => typeof value === 'string',
        )
      : []
    const conflicts = Array.isArray(conclusionResult.conflicts)
      ? conclusionResult.conflicts.filter(
          (value): value is string => typeof value === 'string',
        )
      : []
    const summaryText = [
      normalizeTimingLanguage(conclusionResult.bottomLine),
      typeof conclusionResult.mostLikelyScenario === 'string'
        ? formatMostLikelyScenario(conclusionResult.mostLikelyScenario)
        : null,
      confidence?.level ? `Confidence is ${confidence.level}.` : null,
      conflicts.length > 0
        ? `Biggest uncertainty: ${lowerFirst(conflicts[0].replace(/\.$/, ''))}.`
        : null,
      !conflicts.length && !keySignals.length && confidence?.reason
        ? `That confidence is mainly because ${lowerFirst(confidence.reason.replace(/\.$/, ''))}.`
        : null,
    ]
      .filter(Boolean)
      .join(' ')

    return normalizeTimingLanguage(summaryText)
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
  const recoveredLocationQuery =
    latestRecoveredLocationQuery(toolResults) ??
    inferLocationQueryFromQuestion(userQuestion)
  const locationInput = {
    locationQuery:
      recoveredLocationQuery ??
      (classification.locationRequired ? null : 'United States'),
  }

  if (!locationInput.locationQuery) {
    return []
  }

  switch (classification.intent) {
    case 'severe-weather':
      await Promise.allSettled([
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_severe_context',
          locationInput,
          () => getSevereContext(app, locationInput.locationQuery),
        ),
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_short_range_guidance',
          locationInput,
          () => getShortRangeGuidance(app, locationInput.locationQuery),
        ),
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_radar_satellite_nowcast',
          locationInput,
          () => getRadarSatelliteNowcast(app, locationInput.locationQuery),
        ),
      ])
      break
    case 'short-range-model':
    case 'blend-analysis':
      await Promise.allSettled([
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_short_range_guidance',
          locationInput,
          () => getShortRangeGuidance(app, locationInput.locationQuery),
        ),
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_radar_satellite_nowcast',
          locationInput,
          () => getRadarSatelliteNowcast(app, locationInput.locationQuery),
        ),
      ])
      break
    case 'precipitation':
    case 'hydrology':
      await Promise.allSettled([
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_precip_flood_context',
          locationInput,
          () => getPrecipFloodContext(app, locationInput.locationQuery),
        ),
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_radar_satellite_nowcast',
          locationInput,
          () => getRadarSatelliteNowcast(app, locationInput.locationQuery),
        ),
      ])
      break
    case 'global-model':
    case 'medium-range':
      await maybeRecoverTool(
        recovered,
        existingToolNames,
        'get_global_guidance',
        locationInput,
        () => getGlobalGuidance(app, locationInput.locationQuery),
      )
      break
    case 'radar':
    case 'radar-analysis':
    case 'satellite':
    case 'mrms':
      await maybeRecoverTool(
        recovered,
        existingToolNames,
        'get_radar_satellite_nowcast',
        locationInput,
        () => getRadarSatelliteNowcast(app, locationInput.locationQuery),
      )
      break
    default:
      break
  }

  const combinedToolResults = dedupeToolResults([...toolResults, ...recovered])
  if (
    !combinedToolResults.some(
      (toolResult) => toolResult.toolName === 'synthesize_weather_conclusion',
    )
  ) {
    const synthesisInput = {
      userQuestion,
      workflow: classification.intent as any,
      timeHorizonHours: classification.timeHorizonHours,
      severeContext: latestEnvelope(combinedToolResults, 'get_severe_context'),
      shortRangeGuidance: latestEnvelope(
        combinedToolResults,
        'get_short_range_guidance',
      ),
      globalGuidance: latestEnvelope(
        combinedToolResults,
        'get_global_guidance',
      ),
      precipFloodContext: latestEnvelope(
        combinedToolResults,
        'get_precip_flood_context',
      ),
      radarSatelliteNowcast: latestEnvelope(
        combinedToolResults,
        'get_radar_satellite_nowcast',
      ),
      aviationContext: latestEnvelope(
        combinedToolResults,
        'get_aviation_context',
      ),
    }

    if (
      synthesisInput.severeContext ||
      synthesisInput.shortRangeGuidance ||
      synthesisInput.globalGuidance ||
      synthesisInput.precipFloodContext ||
      synthesisInput.radarSatelliteNowcast ||
      synthesisInput.aviationContext
    ) {
      recovered.push({
        toolCallId: 'recovery-synthesize_weather_conclusion',
        toolName: 'synthesize_weather_conclusion',
        input: synthesisInput,
        result: synthesizeWeatherConclusion(synthesisInput),
      })
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
    synthesizedResult &&
    !hasArtifactPayload(toolResultsWithSynthesis)
  ) {
    try {
      const artifact = await generateArtifact(app, {
        artifactType: 'brief-report',
        locationQuery: locationInput.locationQuery,
        prompt: `Supported severe-weather visual summary for ${locationInput.locationQuery}`,
        sections: artifactSectionsFromConclusion(synthesizedResult),
      })
      recovered.push({
        toolCallId: 'recovery-generate_weather_artifact',
        toolName: 'generate_weather_artifact',
        input: {
          artifactType: 'brief-report',
          locationQuery: locationInput.locationQuery,
        },
        result: artifact,
      })
    } catch {
      // Artifact recovery is best-effort only.
    }
  }

  return recovered
}
