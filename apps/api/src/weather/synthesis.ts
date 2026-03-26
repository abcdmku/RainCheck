import {
  type Citation,
  type WeatherWorkflow,
  weatherConclusionSchema,
} from '@raincheck/contracts'

import type {
  WeatherArtifactHandle,
  WeatherEnvelope,
  WeatherProductCard,
} from './runtime'
import { normalizeTimingLanguage } from './timing-language'

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

function compactText(value: string, maxChars = 180) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) {
    return normalized
  }

  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`
}

function isChaseQuestion(question: string) {
  return /\b(chase|tornado target|follow these storms|start the chase|best plan|where should i start|what time|when should i start)\b/i.test(
    question,
  )
}

function isMapVisualQuestion(question: string) {
  return /\b(map|graphic|visual|mark the times|mark times|mark where|show on a map|show me on a map)\b/i.test(
    question,
  )
}

function isTargetedSevereQuestion(question: string) {
  return /\b(chase|target|avoid|where|when|what time|timing|start)\b/i.test(
    question,
  )
}

function activeSevereProduct(input: SynthesisInput) {
  const products = Array.isArray((input.severeContext?.data as any)?.products)
    ? ((input.severeContext?.data as any)?.products as Array<
        Record<string, any>
      >)
    : []

  return (
    products.find((product) => typeof product.locationRelevance === 'string') ??
    products.find(
      (product) =>
        typeof product.riskHeadline === 'string' &&
        !/no severe thunderstorm areas forecast/i.test(product.riskHeadline),
    ) ??
    products[0]
  )
}

function severeRiskSentence(input: SynthesisInput) {
  const product = activeSevereProduct(input)
  const riskHeadline =
    typeof product?.riskHeadline === 'string' ? product.riskHeadline : ''
  const match = riskHeadline.match(
    /^THERE IS AN? (.+?) OF SEVERE THUNDERSTORMS ACROSS (.+)$/i,
  )

  if (!match) {
    return compactText(
      String(product?.summary ?? input.severeContext?.summary ?? ''),
      180,
    )
  }

  return compactText(
    `The SPC keeps ${match[2].toLowerCase()} in ${match[1].toLowerCase()} for severe thunderstorms.`,
    180,
  )
}

function extractTimingPhrase(value: string) {
  const match = value.match(
    /\b(?:late\s+\w+\s+afternoon(?:\s+and\s+evening)?|afternoon(?:\s+and\s+evening)?|evening|overnight|tonight|tomorrow afternoon|tomorrow evening)\b/i,
  )
  return match?.[0] ?? null
}

function buildSevereBottomLine(input: SynthesisInput, locationLabel: string) {
  const riskSentence = severeRiskSentence(input)
  const product = activeSevereProduct(input)
  const severeSummary = String(
    product?.summary ?? input.severeContext?.summary ?? '',
  )
  const timing = extractTimingPhrase(severeSummary)
  const shortLocation = locationLabel.split(',')[0]?.trim() || locationLabel

  if (isMapVisualQuestion(input.userQuestion) && timing) {
    return compactText(
      `From ${shortLocation}, the best-supported call is a ${timing.toLowerCase()} severe-weather window, and RainCheck can support that with official outlook and loop visuals rather than an annotated chase map.`,
      210,
    )
  }

  if (isMapVisualQuestion(input.userQuestion)) {
    return compactText(
      `From ${shortLocation}, RainCheck can support the broader severe corridor with official outlook and loop visuals, but not an annotated go-here-at-this-time map.`,
      210,
    )
  }

  if (isChaseQuestion(input.userQuestion) && timing) {
    return compactText(
      `From ${shortLocation}, treat ${timing.toLowerCase()} as the main severe-weather window and keep the exact storm corridor flexible until later nowcast trends tighten it.`,
      210,
    )
  }

  if (isChaseQuestion(input.userQuestion)) {
    return compactText(
      `From ${shortLocation}, the best current call is to keep the broader severe corridor flexible until later short-range trends tighten the main hazard window.`,
      210,
    )
  }

  return riskSentence
}

function buildSevereMostLikelyScenario(
  input: SynthesisInput,
  locationLabel: string,
) {
  const product = activeSevereProduct(input)
  const severeSummary = compactText(
    String(product?.summary ?? input.severeContext?.summary ?? ''),
    200,
  )
  const timing = extractTimingPhrase(severeSummary)

  if (isMapVisualQuestion(input.userQuestion) && timing) {
    return compactText(
      `The most likely outcome is organized severe storms arriving from ${timing.toLowerCase()} onward, with official outlook graphics best representing the broader corridor until later nowcast loops fill in.`,
      200,
    )
  }

  if (isMapVisualQuestion(input.userQuestion)) {
    return compactText(
      'The most likely outcome is a broader severe corridor remaining the main focus, with official outlook graphics better suited than an annotated route map until later nowcast details are available.',
      200,
    )
  }

  if (isChaseQuestion(input.userQuestion) && timing) {
    return compactText(
      `The most likely outcome is storms becoming most organized from ${timing.toLowerCase()} onward, with tornado potential highest if cells stay discrete before clustering later.`,
      200,
    )
  }

  if (isChaseQuestion(input.userQuestion)) {
    return compactText(
      'The most likely outcome is organized severe storms developing later in the period, with the highest tornado risk tied to storms that stay discrete before clustering.',
      200,
    )
  }

  return (
    severeSummary ||
    `The main severe-weather threat remains centered on ${locationLabel}.`
  )
}

function adjustedConfidenceScore(
  workflow: WeatherWorkflow,
  input: SynthesisInput,
  score: number,
) {
  if (
    workflow === 'severe-weather' &&
    isTargetedSevereQuestion(input.userQuestion) &&
    (!input.shortRangeGuidance || !input.radarSatelliteNowcast)
  ) {
    return Math.min(score, 0.74)
  }

  return score
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

function normalizeCards(cards: Array<WeatherProductCard>) {
  return cards.map((card) => ({
    ...card,
    title: normalizeTimingLanguage(card.title),
    summary: normalizeTimingLanguage(card.summary),
    imageAlt: card.imageAlt
      ? normalizeTimingLanguage(card.imageAlt)
      : undefined,
  }))
}

function dedupeCitations(citations: Array<Citation>) {
  const deduped = new Map<string, Citation>()

  for (const citation of citations) {
    const key =
      citation.id ||
      `${citation.sourceId}:${citation.productId}:${citation.url ?? ''}`
    deduped.set(key, citation)
  }

  return [...deduped.values()]
}

function curatedCitations(
  workflow: WeatherWorkflow,
  citations: Array<Citation>,
  cards: Array<WeatherProductCard>,
) {
  const ordered = dedupeCitations(citations)

  if (ordered.length <= 4) {
    return ordered
  }

  const preferredByCard = cards
    .flatMap((card) =>
      ordered.filter(
        (citation) =>
          citation.sourceId === card.sourceId ||
          citation.productId === card.id ||
          citation.url === card.url,
      ),
    )
    .slice(0, 4)

  const fallback = workflow === 'severe-weather' ? ordered.slice(0, 4) : ordered

  return dedupeCitations(
    preferredByCard.length > 0 ? preferredByCard : fallback,
  ).slice(0, 4)
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
    if (
      !product ||
      typeof product !== 'object' ||
      typeof product.title !== 'string'
    ) {
      return []
    }

    return [
      {
        id: String(product.productId ?? `${envelope.sourceId}-${index}`),
        title: product.title,
        sourceId:
          typeof product.sourceId === 'string'
            ? product.sourceId
            : envelope.sourceId,
        sourceName:
          typeof product.sourceName === 'string'
            ? product.sourceName
            : envelope.sourceName,
        summary:
          typeof product.summary === 'string'
            ? product.summary
            : envelope.summary,
        url: typeof product.url === 'string' ? product.url : undefined,
        imageUrl:
          typeof product.imageUrl === 'string' ? product.imageUrl : undefined,
        imageAlt:
          typeof product.imageAlt === 'string' ? product.imageAlt : undefined,
        artifactId:
          typeof product.artifactId === 'string'
            ? product.artifactId
            : undefined,
        href: typeof product.href === 'string' ? product.href : undefined,
        mimeType:
          typeof product.mimeType === 'string' ? product.mimeType : undefined,
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
      return [
        'radarSatelliteNowcast',
        'currentConditions',
        'alerts',
        'forecast',
      ]
    case 'short-range-model':
    case 'blend-analysis':
      return [
        'shortRangeGuidance',
        'radarSatelliteNowcast',
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
  const sourceNames = dedupeStrings(
    entries.map((entry) => entry.envelope.sourceName),
  )
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
      bottomLine:
        'RainCheck does not have enough weather context to make a supported call yet.',
      confidence: {
        level: 'low',
        reason:
          'No normalized weather tool output was provided to the synthesis step.',
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
    entries.flatMap(
      (entry) => entry.envelope.normalizedForecast.conflicts ?? [],
    ),
  )
  const adjustedAverage = adjustedConfidenceScore(
    workflow,
    input,
    conflicts.length > 1 ? Math.max(0.45, average - 0.08) : average,
  )
  const level = confidenceLevel(adjustedAverage)
  const cards = dedupeCards(
    entries.flatMap((entry) => cardsFromEnvelope(entry.envelope)),
  ).sort((left, right) => {
    if (left.relevance === right.relevance) {
      return left.title.localeCompare(right.title)
    }

    return left.relevance === 'primary' ? -1 : 1
  })
  const citations = curatedCitations(
    workflow,
    entries.flatMap((entry) => entry.envelope.citations),
    cards,
  )
  const artifacts = dedupeArtifacts(
    entries.flatMap((entry) => entry.envelope.artifacts ?? []),
  )
  const keySignals = dedupeStrings(
    entries.flatMap((entry) =>
      (entry.envelope.normalizedForecast.keySignals ?? []).map((signal) =>
        normalizeTimingLanguage(compactText(signal.detail, 160)),
      ),
    ),
  ).slice(0, 5)
  const alternateScenarios = dedupeStrings(
    entries.flatMap((entry) =>
      (entry.envelope.normalizedForecast.alternateScenarios ?? []).map(
        (value) => normalizeTimingLanguage(compactText(value, 160)),
      ),
    ),
  ).slice(0, 3)
  const whatWouldChangeTheForecast = dedupeStrings(
    entries.flatMap((entry) =>
      (entry.envelope.normalizedForecast.whatWouldChange ?? []).map((value) =>
        normalizeTimingLanguage(compactText(value, 160)),
      ),
    ),
  ).slice(0, 3)
  const bottomLine = normalizeTimingLanguage(
    workflow === 'severe-weather'
      ? buildSevereBottomLine(input, locationLabel)
      : buildBottomLine(workflow, primary, locationLabel),
  )
  const mostLikelyScenario = normalizeTimingLanguage(
    workflow === 'severe-weather'
      ? buildSevereMostLikelyScenario(input, locationLabel)
      : primary.normalizedForecast.mostLikelyScenario ||
          primary.summary ||
          `The most likely outcome stays centered on ${locationLabel}.`,
  )

  return weatherConclusionSchema.parse({
    bottomLine,
    confidence: {
      level,
      reason: confidenceReason(workflow, entries, level),
    },
    mostLikelyScenario,
    alternateScenarios: alternateScenarios.map(normalizeTimingLanguage),
    keySignals,
    conflicts: conflicts.map(normalizeTimingLanguage),
    whatWouldChangeTheForecast,
    recommendedArtifacts: dedupeStrings(
      cards
        .filter((card) => Boolean(card.href || card.artifactId))
        .slice(0, 4)
        .map((card) => card.artifactId ?? card.title),
    ),
    productCards: normalizeCards(cards.slice(0, 4)),
    citations,
    artifacts,
  })
}
