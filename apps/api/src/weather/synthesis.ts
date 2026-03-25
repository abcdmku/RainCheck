import {
  weatherConclusionSchema,
  type Citation,
  type WeatherWorkflow,
} from '@raincheck/contracts'

import type { WeatherArtifactHandle, WeatherEnvelope, WeatherProductCard } from './runtime'

type SynthesisInput = {
  userQuestion: string
  workflow?: WeatherWorkflow
  locationQuery?: string
  timeHorizonHours?: number
  currentConditions?: WeatherEnvelope<any>
  forecast?: WeatherEnvelope<any>
  alerts?: WeatherEnvelope<any>
  shortRangeGuidance?: WeatherEnvelope<any>
  globalGuidance?: WeatherEnvelope<any>
  severeContext?: WeatherEnvelope<any>
  precipFloodContext?: WeatherEnvelope<any>
  radarSatelliteNowcast?: WeatherEnvelope<any>
  aviationContext?: WeatherEnvelope<any>
}

type PrimaryEnvelopeKey =
  | 'currentConditions'
  | 'forecast'
  | 'alerts'
  | 'shortRangeGuidance'
  | 'globalGuidance'
  | 'severeContext'
  | 'precipFloodContext'
  | 'radarSatelliteNowcast'
  | 'aviationContext'

type EnvelopeEntry = {
  key: PrimaryEnvelopeKey
  envelope: WeatherEnvelope<any>
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

function dedupeStrings(values: Array<string>) {
  const deduped = new Set<string>()

  for (const value of values) {
    const normalized = value.trim()
    if (normalized) {
      deduped.add(normalized)
    }
  }

  return [...deduped]
}

function dedupeCards(cards: Array<WeatherProductCard>) {
  const deduped = new Map<string, WeatherProductCard>()

  for (const card of cards) {
    deduped.set(card.id, card)
  }

  return [...deduped.values()]
}

function dedupeCitations(citations: Array<Citation>) {
  const deduped = new Map<string, Citation>()

  for (const citation of citations) {
    const key = citation.id || `${citation.sourceId}:${citation.productId}:${citation.url ?? ''}`
    deduped.set(key, citation)
  }

  return [...deduped.values()]
}

function dedupeArtifacts(artifacts: Array<WeatherArtifactHandle>) {
  const deduped = new Map<string, WeatherArtifactHandle>()

  for (const artifact of artifacts) {
    deduped.set(artifact.artifactId, artifact)
  }

  return [...deduped.values()]
}

function averageConfidence(entries: Array<EnvelopeEntry>) {
  if (entries.length === 0) {
    return 0.5
  }

  return (
    entries.reduce((sum, entry) => sum + entry.envelope.confidence, 0) /
    entries.length
  )
}

function getEntries(input: SynthesisInput) {
  const entries: Array<EnvelopeEntry> = []

  const pairs: Array<[PrimaryEnvelopeKey, WeatherEnvelope<any> | undefined]> = [
    ['currentConditions', input.currentConditions],
    ['forecast', input.forecast],
    ['alerts', input.alerts],
    ['shortRangeGuidance', input.shortRangeGuidance],
    ['globalGuidance', input.globalGuidance],
    ['severeContext', input.severeContext],
    ['precipFloodContext', input.precipFloodContext],
    ['radarSatelliteNowcast', input.radarSatelliteNowcast],
    ['aviationContext', input.aviationContext],
  ]

  for (const [key, envelope] of pairs) {
    if (envelope) {
      entries.push({ key, envelope })
    }
  }

  return entries
}

function cardsFromEnvelope(envelope: WeatherEnvelope<any>) {
  const normalizedCards = envelope.normalizedForecast.productCards ?? []
  if (normalizedCards.length > 0) {
    return normalizedCards
  }

  const products = Array.isArray((envelope.data as any)?.products)
    ? (envelope.data as any).products
    : []

  return products.flatMap((product: any, index: number) => {
    if (!product || typeof product !== 'object' || typeof product.title !== 'string') {
      return []
    }

    return [
      {
        id: String(product.productId ?? `${envelope.sourceId}-${index}`),
        title: product.title,
        sourceId:
          typeof product.sourceId === 'string' ? product.sourceId : envelope.sourceId,
        sourceName:
          typeof product.sourceName === 'string'
            ? product.sourceName
            : envelope.sourceName,
        summary:
          typeof product.summary === 'string' ? product.summary : envelope.summary,
        url: typeof product.url === 'string' ? product.url : undefined,
        imageUrl:
          typeof product.imageUrl === 'string'
            ? product.imageUrl
            : undefined,
        imageAlt:
          typeof product.imageAlt === 'string'
            ? product.imageAlt
            : undefined,
        artifactId:
          typeof product.artifactId === 'string'
            ? product.artifactId
            : undefined,
        href: typeof product.href === 'string' ? product.href : undefined,
        mimeType:
          typeof product.mimeType === 'string'
            ? product.mimeType
            : undefined,
        relevance: index === 0 ? 'primary' : 'supporting',
      } satisfies WeatherProductCard,
    ]
  })
}

function chooseWorkflow(input: SynthesisInput) {
  if (input.workflow) {
    return input.workflow
  }

  if (input.aviationContext) {
    return 'aviation'
  }
  if (input.precipFloodContext) {
    return 'precipitation'
  }
  if (input.severeContext) {
    return 'severe-weather'
  }
  if (input.globalGuidance && (input.timeHorizonHours ?? 0) >= 48) {
    return 'global-model'
  }
  if (input.radarSatelliteNowcast) {
    return 'radar-analysis'
  }
  if (input.shortRangeGuidance) {
    return 'short-range-model'
  }

  return 'forecast'
}

function orderedKeysForWorkflow(
  workflow: WeatherWorkflow,
  timeHorizonHours = 0,
): Array<PrimaryEnvelopeKey> {
  switch (workflow) {
    case 'severe-weather':
      return [
        'severeContext',
        'radarSatelliteNowcast',
        'shortRangeGuidance',
        'alerts',
        'currentConditions',
        'forecast',
      ]
    case 'precipitation':
    case 'hydrology':
      return [
        'precipFloodContext',
        'radarSatelliteNowcast',
        'alerts',
        'currentConditions',
        'forecast',
      ]
    case 'global-model':
    case 'medium-range':
      return ['globalGuidance', 'forecast', 'alerts', 'currentConditions']
    case 'aviation':
      return ['aviationContext', 'alerts', 'currentConditions', 'forecast']
    case 'radar':
    case 'radar-analysis':
    case 'satellite':
    case 'mrms':
      return ['radarSatelliteNowcast', 'currentConditions', 'alerts', 'forecast']
    case 'short-range-model':
    case 'blend-analysis':
      return [
        timeHorizonHours <= 6 ? 'radarSatelliteNowcast' : 'shortRangeGuidance',
        'shortRangeGuidance',
        'currentConditions',
        'forecast',
        'alerts',
      ]
    case 'weather-analysis':
      if (timeHorizonHours >= 48) {
        return [
          'globalGuidance',
          'severeContext',
          'precipFloodContext',
          'radarSatelliteNowcast',
          'shortRangeGuidance',
          'forecast',
          'alerts',
          'currentConditions',
        ]
      }

      return [
        'radarSatelliteNowcast',
        'severeContext',
        'shortRangeGuidance',
        'precipFloodContext',
        'currentConditions',
        'forecast',
        'alerts',
      ]
    default:
      return timeHorizonHours <= 6
        ? ['currentConditions', 'radarSatelliteNowcast', 'forecast', 'alerts']
        : ['forecast', 'alerts', 'currentConditions']
  }
}

function sortedEntries(input: SynthesisInput) {
  const entries = getEntries(input)
  const workflow = chooseWorkflow(input)
  const order = orderedKeysForWorkflow(workflow, input.timeHorizonHours)

  return entries.sort((left, right) => {
    const leftRank = order.indexOf(left.key)
    const rightRank = order.indexOf(right.key)
    return (
      (leftRank === -1 ? Number.MAX_SAFE_INTEGER : leftRank) -
      (rightRank === -1 ? Number.MAX_SAFE_INTEGER : rightRank)
    )
  })
}

function confidenceReason(
  workflow: WeatherWorkflow,
  entries: Array<EnvelopeEntry>,
  level: 'low' | 'medium' | 'high',
) {
  const sourceNames = dedupeStrings(entries.map((entry) => entry.envelope.sourceName))
  const joinedSources = sourceNames.slice(0, 3).join(', ')

  switch (workflow) {
    case 'severe-weather':
      return level === 'high'
        ? `High because SPC context, short-range guidance, and real-time observations are aligned enough to support one target call.`
        : `Lower because the severe setup still depends on mesoscale details, even with ${joinedSources} available.`
    case 'precipitation':
    case 'hydrology':
      return level === 'high'
        ? 'High because WPC rainfall guidance and NWPS river context both support the same flood concern.'
        : `Lower because the flood call is leaning on an incomplete mix of ${joinedSources}.`
    case 'global-model':
    case 'medium-range':
      return level === 'high'
        ? 'High because the global guidance families agree on the larger-scale pattern.'
        : `Lower because medium-range spread remains meaningful across ${joinedSources}.`
    case 'aviation':
      return level === 'high'
        ? 'High because the terminal observations, forecast, and hazard products line up cleanly.'
        : `Lower because aviation hazards can evolve faster than the latest station package reflects.`
    default:
      return level === 'high'
        ? 'High because the most important sources are consistent enough to support a single answer.'
        : `Lower because the answer is leaning on partial or conflicting source coverage from ${joinedSources}.`
  }
}

function buildBottomLine(
  workflow: WeatherWorkflow,
  primary: WeatherEnvelope<any>,
  locationLabel: string,
) {
  switch (workflow) {
    case 'severe-weather':
      return primary.normalizedForecast.headline
    case 'precipitation':
    case 'hydrology':
      return primary.normalizedForecast.headline
    case 'global-model':
    case 'medium-range':
      return primary.normalizedForecast.headline
    case 'aviation':
      return primary.normalizedForecast.headline
    default:
      return (
        primary.normalizedForecast.headline ||
        `The best-supported forecast call right now is centered on ${locationLabel}.`
      )
  }
}

export function synthesizeWeatherConclusion(input: SynthesisInput) {
  const entries = sortedEntries(input)
  const workflow = chooseWorkflow(input)

  if (entries.length === 0) {
    return weatherConclusionSchema.parse({
      bottomLine: 'RainCheck does not have enough weather context to make a supported call yet.',
      confidence: {
        level: 'low',
        reason: 'No normalized weather tool output was provided to the synthesis step.',
      },
      mostLikelyScenario:
        'The safest next step is to fetch the relevant weather context before making a forecast judgment.',
      alternateScenarios: [],
      keySignals: [],
      conflicts: ['No weather sources were supplied to the synthesis tool.'],
      whatWouldChangeTheForecast: ['Add the relevant weather context first.'],
      recommendedArtifacts: [],
      productCards: [],
      citations: [],
      artifacts: [],
    })
  }

  const primary = entries[0].envelope
  const locationLabel =
    primary.location.name || input.locationQuery || 'the requested area'
  const average = averageConfidence(entries)
  const conflicts = dedupeStrings(
    entries.flatMap((entry) => entry.envelope.normalizedForecast.conflicts ?? []),
  )
  const adjustedAverage =
    conflicts.length > 1 ? Math.max(0.45, average - 0.08) : average
  const level = confidenceLevel(adjustedAverage)
  const cards = dedupeCards(
    entries.flatMap((entry) => cardsFromEnvelope(entry.envelope)),
  ).sort((left, right) => {
    if (left.relevance === right.relevance) {
      return left.title.localeCompare(right.title)
    }

    return left.relevance === 'primary' ? -1 : 1
  })
  const citations = dedupeCitations(
    entries.flatMap((entry) => entry.envelope.citations),
  )
  const artifacts = dedupeArtifacts(
    entries.flatMap((entry) => entry.envelope.artifacts ?? []),
  )
  const keySignals = dedupeStrings(
    entries.flatMap((entry) =>
      (entry.envelope.normalizedForecast.keySignals ?? []).map(
        (signal) => signal.detail,
      ),
    ),
  ).slice(0, 5)
  const alternateScenarios = dedupeStrings(
    entries.flatMap(
      (entry) => entry.envelope.normalizedForecast.alternateScenarios ?? [],
    ),
  ).slice(0, 3)
  const whatWouldChangeTheForecast = dedupeStrings(
    entries.flatMap(
      (entry) => entry.envelope.normalizedForecast.whatWouldChange ?? [],
    ),
  ).slice(0, 3)

  return weatherConclusionSchema.parse({
    bottomLine: buildBottomLine(workflow, primary, locationLabel),
    confidence: {
      level,
      reason: confidenceReason(workflow, entries, level),
    },
    mostLikelyScenario:
      primary.normalizedForecast.mostLikelyScenario ||
      primary.summary ||
      `The most likely outcome stays centered on ${locationLabel}.`,
    alternateScenarios,
    keySignals,
    conflicts,
    whatWouldChangeTheForecast,
    recommendedArtifacts: dedupeStrings(
      cards
        .filter((card) => Boolean(card.href || card.artifactId))
        .slice(0, 4)
        .map((card) => card.artifactId ?? card.title),
    ),
    productCards: cards.slice(0, 4),
    citations,
    artifacts,
  })
}
