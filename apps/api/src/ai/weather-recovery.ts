import type { RequestClassification } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import {
  getPrecipFloodContext,
  getRadarSatelliteNowcast,
  getSevereContext,
} from '../weather/domain-tools'
import { getGlobalGuidance, getShortRangeGuidance } from '../weather/models'
import type { WeatherEnvelope } from '../weather/runtime'
import { synthesizeWeatherConclusion } from '../weather/synthesis'

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
  return isWeatherEnvelope(result) ? (result as WeatherEnvelope<any>) : undefined
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
    return confidence.toLowerCase()
  }

  if (
    isRecord(confidence) &&
    typeof confidence.level === 'string' &&
    typeof confidence.reason === 'string'
  ) {
    return `${confidence.level.toLowerCase()} because ${confidence.reason}`
  }

  return null
}

function lowerFirst(value: string) {
  return value ? value.charAt(0).toLowerCase() + value.slice(1) : value
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
    const products = Array.isArray(conclusionResult.productCards)
      ? conclusionResult.productCards
          .map((product) =>
            isRecord(product) && typeof product.title === 'string'
              ? product.title
              : null,
          )
          .filter((value): value is string => value != null)
      : []

    const firstParagraph = [
      conclusionResult.bottomLine,
      typeof conclusionResult.mostLikelyScenario === 'string'
        ? `Most likely, ${lowerFirst(conclusionResult.mostLikelyScenario)}`
        : null,
      confidence ? `Confidence is ${confidence}.` : null,
    ]
      .filter(Boolean)
      .join(' ')

    const secondParagraph = [
      keySignals.length > 0
        ? `The main reasons are ${keySignals
            .slice(0, 2)
            .map((signal) => lowerFirst(signal.replace(/\.$/, '')))
            .join('; ')}.`
        : null,
      conflicts.length > 0
        ? `The main uncertainty is ${lowerFirst(conflicts[0].replace(/\.$/, ''))}.`
        : null,
      products.length > 0
        ? `I leaned most on ${products.slice(0, 3).join(', ')}.`
        : null,
    ]
      .filter(Boolean)
      .join(' ')

    return [firstParagraph, secondParagraph].filter(Boolean).join('\n\n')
  }

  const latestWeatherResult = [...toolResults]
    .reverse()
    .map((toolResult) => toolResult.result)
    .find(isWeatherEnvelope)

  if (latestWeatherResult) {
    return latestWeatherResult.summary
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
  const existingToolNames = new Set(toolResults.map((toolResult) => toolResult.toolName))
  const locationInput = {
    locationQuery: userQuestion,
  }

  switch (classification.intent) {
    case 'severe-weather':
      await Promise.allSettled([
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_severe_context',
          locationInput,
          () => getSevereContext(app, userQuestion),
        ),
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_short_range_guidance',
          locationInput,
          () => getShortRangeGuidance(app, userQuestion),
        ),
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_radar_satellite_nowcast',
          locationInput,
          () => getRadarSatelliteNowcast(app, userQuestion),
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
          () => getShortRangeGuidance(app, userQuestion),
        ),
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_radar_satellite_nowcast',
          locationInput,
          () => getRadarSatelliteNowcast(app, userQuestion),
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
          () => getPrecipFloodContext(app, userQuestion),
        ),
        maybeRecoverTool(
          recovered,
          existingToolNames,
          'get_radar_satellite_nowcast',
          locationInput,
          () => getRadarSatelliteNowcast(app, userQuestion),
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
        () => getGlobalGuidance(app, userQuestion),
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
        () => getRadarSatelliteNowcast(app, userQuestion),
      )
      break
    default:
      break
  }

  const combinedToolResults = dedupeToolResults([...toolResults, ...recovered])
  if (!combinedToolResults.some((toolResult) => toolResult.toolName === 'synthesize_weather_conclusion')) {
    const synthesisInput = {
      userQuestion,
      workflow: classification.intent as any,
      timeHorizonHours: classification.timeHorizonHours,
      severeContext: latestEnvelope(combinedToolResults, 'get_severe_context'),
      shortRangeGuidance: latestEnvelope(
        combinedToolResults,
        'get_short_range_guidance',
      ),
      globalGuidance: latestEnvelope(combinedToolResults, 'get_global_guidance'),
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

  return recovered
}
