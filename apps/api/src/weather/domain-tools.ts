import { weatherToolEnvelopeSchema, type Citation } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { getAviationSummary } from './aviation'
import { getHydrologyNwps } from './hydrology'
import { getMrmsProducts } from './mrms'
import { getNexradRadar } from './radar'
import { mergeArtifacts } from './previews'
import {
  buildWeatherEnvelope,
  type WeatherEnvelope,
  type WeatherLocationSummary,
  type WeatherProductCard,
  type WeatherSignal,
} from './runtime'
import { getGoesSatellite } from './satellite'
import { getSpcSevereProducts } from './spc'
import { getWpcQpfEro } from './wpc'

type SettledEnvelope = WeatherEnvelope<any>

type CombinedContextData = {
  products: Array<WeatherProductCard>
  notes: Array<string>
  availableSources: Array<string>
  missingSources: Array<string>
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

function inferMimeType(url: string | undefined) {
  if (!url) {
    return undefined
  }

  const normalized = url.split('?')[0]?.toLowerCase() ?? url.toLowerCase()
  if (normalized.endsWith('.gif')) {
    return 'image/gif'
  }
  if (normalized.endsWith('.png')) {
    return 'image/png'
  }
  if (normalized.endsWith('.svg')) {
    return 'image/svg+xml'
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp'
  }

  if (normalized.endsWith('.html') || normalized.endsWith('.htm')) {
    return 'text/html'
  }

  return 'image/jpeg'
}

function averageConfidence(envelopes: Array<SettledEnvelope>) {
  if (envelopes.length === 0) {
    return 0.5
  }

  const total = envelopes.reduce((sum, envelope) => sum + envelope.confidence, 0)
  return total / envelopes.length
}

function dedupeCards(cards: Array<WeatherProductCard>) {
  const deduped = new Map<string, WeatherProductCard>()

  for (const card of cards) {
    deduped.set(card.id, card)
  }

  return [...deduped.values()]
}

function mergeCitations(...groups: Array<Array<Citation> | undefined>) {
  const deduped = new Map<string, Citation>()

  for (const group of groups) {
    for (const citation of group ?? []) {
      const key = citation.id || `${citation.sourceId}:${citation.productId}:${citation.url ?? ''}`
      deduped.set(key, citation)
    }
  }

  return [...deduped.values()]
}

function collectFailureNames(results: Array<PromiseSettledResult<SettledEnvelope>>, labels: Array<string>) {
  return results.flatMap((result, index) => {
    if (result.status === 'fulfilled') {
      return []
    }

    return [labels[index] ?? `source-${index + 1}`]
  })
}

function collectProductCardsFromProducts(
  envelope: SettledEnvelope,
  relevance: 'primary' | 'supporting' = 'supporting',
) {
  if (!Array.isArray((envelope.data as any)?.products)) {
    return [] as Array<WeatherProductCard>
  }

  return (envelope.data as any).products.flatMap((product: any, index: number) => {
    if (!product || typeof product !== 'object') {
      return []
    }

    const title =
      typeof product.title === 'string'
        ? product.title
        : typeof product.productId === 'string'
          ? product.productId
          : envelope.sourceName

    const url =
      typeof product.url === 'string'
        ? product.url
        : typeof envelope.citations[0]?.url === 'string'
          ? envelope.citations[0].url
          : undefined

    const imageUrl =
      typeof product.imageUrl === 'string'
        ? product.imageUrl
        : index === 0
          ? envelope.thumbnailUrl
          : undefined

    const href =
      typeof product.href === 'string'
        ? product.href
        : imageUrl ?? url

    return [
      {
        id: String(product.productId ?? `${envelope.sourceId}-${index}`),
        title,
        sourceId:
          typeof product.sourceId === 'string' ? product.sourceId : envelope.sourceId,
        sourceName:
          typeof product.sourceName === 'string'
            ? product.sourceName
            : envelope.sourceName,
        summary:
          typeof product.summary === 'string' ? product.summary : envelope.summary,
        url,
        imageUrl,
        imageAlt:
          typeof product.imageAlt === 'string'
            ? product.imageAlt
            : envelope.imageAlt,
        artifactId:
          typeof product.artifactId === 'string'
            ? product.artifactId
            : undefined,
        href,
        mimeType:
          typeof product.mimeType === 'string'
            ? product.mimeType
            : inferMimeType(href),
        relevance,
        validAt: envelope.validAt,
        validRange: envelope.validRange,
      } satisfies WeatherProductCard,
    ]
  })
}

function primaryArtifactCard(
  envelope: SettledEnvelope,
  title: string,
  sourceName = envelope.sourceName,
  relevance: 'primary' | 'supporting' = 'supporting',
) {
  const artifact = envelope.artifacts?.[0]
  const href = artifact?.href ?? envelope.thumbnailUrl

  if (!href) {
    return null
  }

  return {
    id: artifact?.artifactId ?? `${envelope.sourceId}-primary`,
    title,
    sourceId: envelope.sourceId,
    sourceName,
    summary: envelope.summary,
    url: envelope.citations[0]?.url,
    imageUrl: envelope.thumbnailUrl,
    imageAlt: envelope.imageAlt,
    artifactId: artifact?.artifactId,
    href,
    mimeType: artifact?.mimeType ?? inferMimeType(href),
    relevance,
    validAt: envelope.validAt,
    validRange: envelope.validRange,
  } satisfies WeatherProductCard
}

function toSignals(
  envelopes: Array<SettledEnvelope>,
  categories: Array<WeatherSignal['category']>,
) {
  return envelopes.map((envelope, index) => ({
    category: categories[index] ?? 'general',
    weight: index === 0 ? 'high' : 'medium',
    label: envelope.sourceName,
    detail: envelope.summary,
    sourceIds: [envelope.sourceId],
    productIds: [envelope.normalizedForecast.domain],
  })) satisfies Array<WeatherSignal>
}

function validAtFrom(envelopes: Array<SettledEnvelope>) {
  return envelopes.find((envelope) => envelope.validAt)?.validAt
}

function validRangeFrom(envelopes: Array<SettledEnvelope>) {
  return envelopes.find((envelope) => envelope.validRange)?.validRange
}

function sourceForComposite(
  sourceId: string,
  label: string,
  url: string,
  productId: string,
) {
  return {
    sourceId,
    productId,
    label,
    url,
  }
}

export async function getAviationContext(
  app: FastifyInstance,
  stationId: string,
) {
  const result = await getAviationSummary(app, stationId)
  const confidence = 0.82

  return buildWeatherEnvelope({
    source: sourceForComposite(
      'aviationweather-gov',
      'Aviation Weather Center',
      result.citations[0]?.url ?? 'https://aviationweather.gov/data/api/',
      'aviation-context',
    ),
    location: {
      query: stationId,
      name: stationId,
      latitude: 0,
      longitude: 0,
      resolvedBy: 'station-id',
    } satisfies WeatherLocationSummary,
    units: 'aviation-native',
    validAt: new Date().toISOString(),
    confidence,
    summary: result.summary,
    normalizedForecast: {
      domain: 'aviation-context',
      headline: `Use station observations and aviation hazards first for ${stationId}, then fold in the near-term terminal forecast.`,
      mostLikelyScenario: result.summary,
      alternateScenarios: [
        'Confidence drops if nearby convective or icing hazards expand faster than the latest station report reflects.',
      ],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals: [
        {
          category: 'aviation',
          weight: 'high',
          label: 'METAR / TAF',
          detail: result.summary,
          sourceIds: ['aviationweather-gov'],
          productIds: ['metar', 'taf'],
        },
        {
          category: 'aviation',
          weight: 'medium',
          label: 'Hazard products',
          detail: [
            ...result.hazards.sigmets,
            ...result.hazards.gAirmets,
            ...result.hazards.cwas,
            ...result.hazards.pireps,
          ]
            .slice(0, 4)
            .join(' '),
          sourceIds: ['aviationweather-gov'],
          productIds: ['sigmet', 'gairmet', 'cwa', 'pirep'],
        },
      ],
      conflicts: [],
      failureModes: [
        'Aviation hazards can expand between updates, especially in convective situations.',
      ],
      whatWouldChange: [
        'A new SIGMET, G-AIRMET, or deterioration in the next METAR would change the call quickly.',
      ],
      productCards: [],
      recommendedProductIds: ['metar', 'taf', 'sigmet'],
    },
    data: {
      stationId: result.stationId,
      metar: result.metar,
      taf: result.taf,
      hazards: result.hazards,
      products: [],
      notes: [
        'Aviation answers should stay anchored to METAR, TAF, PIREP, SIGMET, and G-AIRMET context.',
      ],
      availableSources: ['aviationweather-gov'],
      missingSources: [],
    } satisfies CombinedContextData & Record<string, unknown>,
    citations: result.citations,
  })
}

export async function getSevereContext(
  app: FastifyInstance,
  locationQuery: string,
) {
  const envelope = await getSpcSevereProducts(app, locationQuery)
  const products = collectProductCardsFromProducts(envelope)
  const confidence = Math.max(envelope.confidence, 0.88)

  return weatherToolEnvelopeSchema.parse({
    ...envelope,
    normalizedForecast: {
      domain: 'severe-context',
      headline: `SPC official severe context should anchor the severe-weather call for ${envelope.location.name}.`,
      mostLikelyScenario:
        typeof (envelope.data as any)?.watchContext === 'string' &&
        typeof (envelope.data as any)?.mesoscaleContext === 'string'
          ? `${envelope.summary} ${(envelope.data as any).watchContext} ${(envelope.data as any).mesoscaleContext}`
          : envelope.summary,
      alternateScenarios: [],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals: [
        {
          category: 'official',
          weight: 'high',
          label: 'SPC outlooks',
          detail: envelope.summary,
          sourceIds: ['spc'],
          productIds: ['spc-convective-outlooks'],
        },
        {
          category: 'hazard',
          weight: 'medium',
          label: 'Watches',
          detail:
            typeof (envelope.data as any)?.watchContext === 'string'
              ? (envelope.data as any).watchContext
              : 'Current convective watch context is limited.',
          sourceIds: ['spc'],
          productIds: ['spc-current-convective-watches'],
        },
        {
          category: 'hazard',
          weight: 'medium',
          label: 'Mesoscale discussions',
          detail:
            typeof (envelope.data as any)?.mesoscaleContext === 'string'
              ? (envelope.data as any).mesoscaleContext
              : 'Current mesoscale discussion context is limited.',
          sourceIds: ['spc'],
          productIds: ['spc-current-mesoscale-discussions'],
        },
      ],
      conflicts: [],
      failureModes: [
        'Storm mode and corridor details can still shift once the mesoscale environment evolves.',
      ],
      whatWouldChange: [
        'A new mesoscale discussion, watch issuance, or a changed Day 1 outlook corridor would change the target call.',
      ],
      productCards: dedupeCards(products).slice(0, 4),
      recommendedProductIds: products
        .slice(0, 4)
        .map((product: WeatherProductCard) => product.id),
    },
  })
}

export async function getPrecipFloodContext(
  app: FastifyInstance,
  locationQuery: string,
) {
  const results = await Promise.allSettled([
    getWpcQpfEro(app, locationQuery),
    getHydrologyNwps(app, locationQuery),
  ])
  const labels = ['WPC', 'NWPS']
  const successful = results
    .filter(
      (result): result is PromiseFulfilledResult<SettledEnvelope> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value)

  if (successful.length === 0) {
    throw new Error('Precipitation and flood context could not be fetched.')
  }

  const wpc = successful.find((envelope) => envelope.sourceId === 'wpc')
  const nwps = successful.find((envelope) => envelope.sourceId === 'nwps')
  const cards = dedupeCards([
    ...(wpc ? collectProductCardsFromProducts(wpc, 'primary') : []),
    ...(nwps
      ? [
          primaryArtifactCard(
            nwps,
            `${(nwps.data as any)?.gauge?.name ?? nwps.location.name} hydrograph`,
            'NWPS',
            'primary',
          ),
        ].filter(Boolean) as Array<WeatherProductCard>
      : []),
  ])
  const missingSources = collectFailureNames(results, labels)
  const confidence = Math.max(0.64, averageConfidence(successful))
  const primary = wpc ?? successful[0]

  return buildWeatherEnvelope({
    source: sourceForComposite(
      primary.sourceId,
      'Precipitation and flood context',
      primary.citations[0]?.url ?? 'https://www.wpc.ncep.noaa.gov/qpf/ero.php',
      'precip-flood-context',
    ),
    location: primary.location,
    units: {
      precipitation: 'in',
      stage: 'ft',
      flow: 'cfs',
    },
    validAt: validAtFrom(successful) ?? primary.retrievedAt,
    validRange: validRangeFrom(successful),
    confidence,
    summary: [wpc?.summary, nwps?.summary].filter(Boolean).join(' '),
    normalizedForecast: {
      domain: 'precip-flood-context',
      headline: `WPC rainfall outlooks and NWPS river guidance should anchor the flood call for ${primary.location.name}.`,
      mostLikelyScenario:
        [wpc?.normalizedForecast.mostLikelyScenario, nwps?.normalizedForecast.mostLikelyScenario]
          .filter(Boolean)
          .join(' ') ||
        [wpc?.summary, nwps?.summary].filter(Boolean).join(' '),
      alternateScenarios: missingSources.length
        ? ['One part of the flood toolset is unavailable, so local flood confidence is lower than ideal.']
        : [],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals: [
        ...(wpc
          ? [
              {
                category: 'official',
                weight: 'high',
                label: 'WPC QPF / ERO',
                detail: wpc.summary,
                sourceIds: ['wpc'],
                productIds: ['qpf', 'ero'],
              } satisfies WeatherSignal,
            ]
          : []),
        ...(nwps
          ? [
              {
                category: 'hydrology',
                weight: 'high',
                label: 'NWPS gauge and forecast',
                detail: nwps.summary,
                sourceIds: ['nwps'],
                productIds: ['gauge-detail', 'stageflow'],
              } satisfies WeatherSignal,
            ]
          : []),
      ],
      conflicts: missingSources.length
        ? [`Missing source coverage: ${missingSources.join(', ')}.`]
        : [],
      failureModes: [
        'Flash-flood and river responses can change quickly if convective rainfall trains over the same area.',
      ],
      whatWouldChange: [
        'A higher WPC rainfall axis or a sharper NWPS river-stage rise would push the flood forecast upward quickly.',
      ],
      productCards: cards.slice(0, 3),
      recommendedProductIds: cards.slice(0, 3).map((card) => card.id),
    },
    data: {
      products: cards,
      notes: [
        'Flood answers should prioritize WPC rainfall guidance and NWPS river data over a generic model summary.',
      ],
      availableSources: successful.map((envelope) => envelope.sourceId),
      missingSources,
    } satisfies CombinedContextData,
    citations: mergeCitations(...successful.map((envelope) => envelope.citations)),
    artifacts: mergeArtifacts(...successful.map((envelope) => envelope.artifacts)),
    thumbnailUrl: cards.find((card) => card.imageUrl)?.imageUrl,
    imageAlt: cards.find((card) => card.imageAlt)?.imageAlt,
  })
}

export async function getRadarSatelliteNowcast(
  app: FastifyInstance,
  locationQuery: string,
) {
  const results = await Promise.allSettled([
    getNexradRadar(app, locationQuery),
    getGoesSatellite(app, locationQuery),
    getMrmsProducts(app, locationQuery),
  ])
  const labels = ['NEXRAD', 'GOES', 'MRMS']
  const successful = results
    .filter(
      (result): result is PromiseFulfilledResult<SettledEnvelope> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value)

  if (successful.length === 0) {
    throw new Error('Radar, satellite, and nowcast context could not be fetched.')
  }

  const radar = successful.find((envelope) => envelope.sourceId === 'nexrad')
  const goes = successful.find((envelope) => envelope.sourceId === 'goes')
  const mrms = successful.find((envelope) => envelope.sourceId === 'mrms')
  const cards = dedupeCards([
    ...(radar ? collectProductCardsFromProducts(radar, 'primary') : []),
    ...(goes
      ? collectProductCardsFromProducts(goes, 'primary').map((card: WeatherProductCard, index: number) => ({
          ...card,
          href: card.href ?? goes.artifacts?.[0]?.href ?? card.imageUrl ?? card.url,
          mimeType:
            card.mimeType ??
            goes.artifacts?.[0]?.mimeType ??
            inferMimeType(card.href ?? card.imageUrl ?? card.url),
          artifactId: card.artifactId ?? goes.artifacts?.[0]?.artifactId,
          relevance: index === 0 ? 'primary' : card.relevance,
        }))
      : []),
    ...(mrms ? collectProductCardsFromProducts(mrms) : []),
  ])
  const missingSources = collectFailureNames(results, labels)
  const confidence = Math.max(0.68, averageConfidence(successful))
  const primary = radar ?? goes ?? successful[0]

  return buildWeatherEnvelope({
    source: sourceForComposite(
      primary.sourceId,
      'Radar, satellite, and nowcast context',
      primary.citations[0]?.url ?? 'https://radar.weather.gov/',
      'radar-satellite-nowcast',
    ),
    location: primary.location,
    units: 'imagery-analysis',
    validAt: validAtFrom(successful) ?? primary.retrievedAt,
    validRange: validRangeFrom(successful),
    confidence,
    summary: [radar?.summary, goes?.summary, mrms?.summary]
      .filter(Boolean)
      .join(' '),
    normalizedForecast: {
      domain: 'radar-satellite-nowcast',
      headline: `For the current and near-term call around ${primary.location.name}, radar, satellite, MRMS, and current analysis outrank model guidance.`,
      mostLikelyScenario:
        [radar?.summary, goes?.summary, mrms?.summary].filter(Boolean).join(' ') ||
        primary.summary,
      alternateScenarios: missingSources.length
        ? ['One of the real-time nowcast sources is unavailable, so near-term confidence is slightly lower.']
        : [],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals: toSignals(
        [radar, goes, mrms].filter((value): value is SettledEnvelope => value != null),
        ['observation', 'analysis', 'analysis'],
      ),
      conflicts: missingSources.length
        ? [`Missing source coverage: ${missingSources.join(', ')}.`]
        : [],
      failureModes: [
        'Near-term convective evolution can still change faster than a stale loop or image frame.',
      ],
      whatWouldChange: [
        'A new radar trend, cloud-top evolution, or MRMS signal would quickly change the nowcast.',
      ],
      productCards: cards.slice(0, 4),
      recommendedProductIds: cards.slice(0, 4).map((card) => card.id),
    },
    data: {
      products: cards,
      notes: [
        'Current and near-term questions should be answered from observations and remote sensing before model guidance.',
      ],
      availableSources: successful.map((envelope) => envelope.sourceId),
      missingSources,
    } satisfies CombinedContextData,
    citations: mergeCitations(...successful.map((envelope) => envelope.citations)),
    artifacts: mergeArtifacts(...successful.map((envelope) => envelope.artifacts)),
    thumbnailUrl: cards.find((card) => card.imageUrl)?.imageUrl,
    imageAlt: cards.find((card) => card.imageAlt)?.imageAlt,
  })
}
