import {
  type RequestClassification,
  weatherRequestedArtifactSchema,
} from '@raincheck/contracts'
import { z } from 'zod'

export type WeatherDerivationEndpoint =
  | 'short-range'
  | 'global'
  | 'radar-nowcast'
  | 'satellite'
  | 'hydrology'

export type NormalizedWeatherLocation = {
  query: string
  name: string
  latitude: number
  longitude: number
  region?: string
  country?: string
  timezone?: string
  resolvedBy: string
}

type PlannedArtifactType = z.infer<
  typeof weatherRequestedArtifactSchema
>['type']

function lowerQuestion(value: string) {
  return value.toLowerCase()
}

function radiusForEndpoint(endpoint: WeatherDerivationEndpoint) {
  switch (endpoint) {
    case 'global':
      return 450
    case 'hydrology':
      return 220
    case 'radar-nowcast':
      return 120
    case 'satellite':
      return 160
    case 'short-range':
    default:
      return 180
  }
}

function focusForClassification(classification: RequestClassification) {
  switch (classification.intent) {
    case 'severe-weather':
      switch (classification.chaseGuidanceLevel) {
        case 'general-target':
          return 'severe-weather timing and starting corridor'
        case 'exact-target':
          return 'severe-weather timing and exact target corridor'
        case 'full-route':
          return 'severe-weather timing and route-level target guidance'
        case 'analysis-only':
        default:
          return 'severe-weather setup and corridor'
      }
    case 'precipitation':
      return 'rainfall and flood timing'
    case 'hydrology':
      return 'hydrology and flood timing'
    case 'winter-weather':
      return 'winter-weather timing and banding'
    case 'medium-range':
    case 'global-model':
      return 'medium-range pattern'
    case 'radar':
    case 'radar-analysis':
    case 'mrms':
      return 'near-term radar and MRMS trends'
    case 'satellite':
      return 'satellite and convective initiation'
    case 'short-range-model':
    case 'blend-analysis':
      return 'short-range convective evolution'
    default:
      return 'weather analysis'
  }
}

function defaultArtifactsForEndpoint(
  endpoint: WeatherDerivationEndpoint,
  classification: RequestClassification,
): Array<{ type: PlannedArtifactType; required: boolean }> {
  if (!classification.needsArtifact) {
    return []
  }

  switch (endpoint) {
    case 'radar-nowcast':
      return [{ type: 'brief-report', required: true }]
    case 'satellite':
      return [{ type: 'brief-report', required: true }]
    case 'hydrology':
      return [{ type: 'brief-report', required: true }]
    case 'global':
      return [{ type: 'single-model-panel', required: true }]
    case 'short-range':
    default:
      return [{ type: 'single-model-panel', required: true }]
  }
}

function questionHints(question: string) {
  const text = lowerQuestion(question)

  if (text.includes('storm mode') || text.includes('mode by')) {
    return {
      domain: 'storm-mode',
      variables: ['storm-mode', 'initiation', 'coverage'],
    }
  }

  if (
    text.includes('tornado') ||
    text.includes('supercell') ||
    text.includes('severe')
  ) {
    return {
      domain: 'severe',
      variables: ['cape', 'cin', 'srh', 'shear', 'lcl', 'stp', 'scp'],
    }
  }

  if (text.includes('hail') || text.includes('wind')) {
    return {
      domain: 'convection',
      variables: ['cape', 'shear', 'lapse-rate', 'updraft-strength'],
    }
  }

  if (
    text.includes('snow') ||
    text.includes('ice') ||
    text.includes('freezing rain') ||
    text.includes('sleet')
  ) {
    return {
      domain: 'snow',
      variables: ['temperature-profile', 'snow-band', 'ice-zone'],
    }
  }

  if (text.includes('fog') || text.includes('low cloud')) {
    return {
      domain: 'fog',
      variables: ['low-clouds', 'visibility', 'boundary-layer-moisture'],
    }
  }

  if (
    text.includes('river') ||
    text.includes('flood') ||
    text.includes('gauge')
  ) {
    return {
      domain: 'flash-flood',
      variables: ['qpf', 'qpe', 'stage', 'flow'],
    }
  }

  if (
    text.includes('pattern') ||
    text.includes('global') ||
    text.includes('synoptic')
  ) {
    return {
      domain: 'pattern',
      variables: ['500mb-height', 'jet', 'ensemble-spread'],
    }
  }

  return null
}

export function planWeatherDerivations(classification: RequestClassification) {
  const plan: Array<WeatherDerivationEndpoint> = []

  switch (classification.intent) {
    case 'severe-weather':
      if (classification.timeHorizonHours >= 72) {
        plan.push('global')
      } else if (classification.timeHorizonHours >= 48) {
        plan.push('global', 'short-range')
      } else {
        plan.push('short-range', 'radar-nowcast')
      }
      break
    case 'precipitation':
    case 'hydrology':
      plan.push('hydrology', 'radar-nowcast')
      break
    case 'winter-weather':
      plan.push('short-range')
      break
    case 'medium-range':
    case 'global-model':
      plan.push('global')
      break
    case 'radar':
    case 'radar-analysis':
    case 'mrms':
      plan.push('radar-nowcast')
      break
    case 'satellite':
      plan.push('satellite')
      break
    case 'short-range-model':
    case 'blend-analysis':
      plan.push('short-range')
      break
    case 'weather-analysis':
    case 'research-brief':
      if (classification.timeHorizonHours >= 48) {
        plan.push('global', 'hydrology')
      } else {
        plan.push('short-range', 'radar-nowcast')
      }
      break
    case 'aviation':
    case 'fire-weather':
    case 'tropical':
    case 'marine':
    case 'upper-air':
    case 'historical-climate':
    case 'storm-history':
      break
    default:
      if (classification.timeHorizonHours >= 48) {
        plan.push('global')
      } else {
        plan.push('short-range')
      }
      break
  }

  return [...new Set(plan)]
}

export function buildWeatherDerivationRequest(input: {
  classification: RequestClassification
  endpoint: WeatherDerivationEndpoint
  location: NormalizedWeatherLocation
  userQuestion: string
  referenceTime?: string
}) {
  const now = input.referenceTime ?? new Date().toISOString()
  const horizonHours = Math.max(1, input.classification.timeHorizonHours || 6)
  const end = new Date(
    Date.parse(now) + horizonHours * 60 * 60 * 1000,
  ).toISOString()
  const questionHint = questionHints(input.userQuestion)
  const focus = focusForClassification(input.classification)
  const derivedFocus =
    questionHint?.domain === 'storm-mode'
      ? 'storm mode and initiation'
      : questionHint?.domain === 'flash-flood'
        ? 'flood timing and peak flow'
        : questionHint?.domain === 'fog'
          ? 'fog and low-cloud timing'
          : questionHint?.domain === 'snow'
            ? 'winter precipitation type and banding'
            : focus

  const domain =
    questionHint?.domain ??
    (input.endpoint === 'short-range'
      ? input.classification.intent === 'winter-weather'
        ? 'snow'
        : input.classification.intent === 'precipitation'
          ? 'severe'
          : 'severe'
      : input.endpoint === 'global'
        ? 'pattern'
        : input.endpoint === 'radar-nowcast'
          ? 'storm-objects'
          : input.endpoint === 'satellite'
            ? 'cloud-top'
            : 'hydrology')

  return {
    userQuestion: input.userQuestion.trim(),
    workflow: input.classification.intent,
    region: {
      type: 'point' as const,
      location: input.location,
      radiusKm: radiusForEndpoint(input.endpoint),
    },
    timeWindow: {
      start: now,
      end,
      referenceTime: now,
      recentHours: Math.min(horizonHours, 72),
    },
    chaseGuidanceLevel: input.classification.chaseGuidanceLevel,
    focus: derivedFocus,
    variables: questionHint?.variables ?? [],
    requestedArtifacts: defaultArtifactsForEndpoint(
      input.endpoint,
      input.classification,
    ),
    includeOfficialContext: true,
    domain,
  }
}
