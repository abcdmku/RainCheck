import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherText,
  type WeatherEnvelope,
  type WeatherProductCard,
  type WeatherSignal,
} from './runtime'

type ModelProduct = {
  productId: string
  modelId: string
  title: string
  summary: string
  url: string
  sourceId: string
  sourceName: string
}

type ModelTarget = ModelProduct & {
  cacheKey: string
}

type LoadedModelTarget = {
  target: ModelTarget
  retrievedAt: string
  cached: boolean
}

type ModelGuidanceData = {
  products: Array<ModelProduct>
  notes: Array<string>
  missingSources: Array<string>
}

function currentModelCycle(reference = new Date()) {
  const year = reference.getUTCFullYear()
  const month = String(reference.getUTCMonth() + 1).padStart(2, '0')
  const day = String(reference.getUTCDate()).padStart(2, '0')
  const cycleHour = Math.floor(reference.getUTCHours() / 6) * 6
  const cycle = String(cycleHour).padStart(2, '0')

  return {
    yyyymmdd: `${year}${month}${day}`,
    cycle,
  }
}

function modelRunUrl(
  family: string,
  suffix = '',
  reference = new Date(),
) {
  const { yyyymmdd, cycle } = currentModelCycle(reference)
  return `https://nomads.ncep.noaa.gov/pub/data/nccf/com/${family}/prod/${family}.${yyyymmdd}/${cycle}${suffix}`
}

function hrrrUrl() {
  return modelRunUrl('hrrr', '/conus/')
}

function rapUrl() {
  return modelRunUrl('rap', '/')
}

function namUrl() {
  return modelRunUrl('nam', '/')
}

function hrefUrl() {
  return modelRunUrl('href', '/conus/')
}

function blendUrl() {
  return modelRunUrl('blend', '/')
}

function rtmaUrl() {
  const { cycle } = currentModelCycle()
  return `https://mag.ncep.noaa.gov/data/rtma/${cycle}/rtma_mid-west_000_2m_temp.gif`
}

function urmaUrl() {
  return modelRunUrl('urma', '/')
}

function gfsUrl() {
  return modelRunUrl('gfs', '/atmos/')
}

function gefsUrl() {
  return modelRunUrl('gefs', '/atmos/')
}

async function loadModelTarget(
  app: FastifyInstance,
  target: ModelTarget,
) {
  const result = await fetchWeatherText(app, {
    sourceId: target.sourceId,
    productId: target.productId,
    label: target.sourceName,
    url: target.url,
    cacheKey: cacheKey(target.cacheKey),
    ttlMs: 10 * 60 * 1000,
  })

  return {
    target,
    retrievedAt: result.retrievedAt,
    cached: result.cached,
  } satisfies LoadedModelTarget
}

function settleModelTargets(
  targets: Array<ModelTarget>,
  results: Array<PromiseSettledResult<LoadedModelTarget>>,
) {
  const successful = results
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<LoadedModelTarget> =>
        result.status === 'fulfilled',
    )
    .map((result) => result.value)

  const missing = results.flatMap((result, index) => {
    if (result.status === 'fulfilled') {
      return []
    }

    return [targets[index]?.sourceName ?? `target-${index}`]
  })

  return {
    successful,
    missing,
  }
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

  return 'image/jpeg'
}

function productCard(
  product: ModelProduct,
  relevance: 'primary' | 'supporting' = 'supporting',
): WeatherProductCard {
  return {
    id: product.productId,
    title: product.title,
    sourceId: product.sourceId,
    sourceName: product.sourceName,
    summary: product.summary,
    url: product.url,
    href: product.url,
    mimeType: inferMimeType(product.url),
    relevance,
  }
}

function buildSignal(
  product: ModelProduct,
  detail: string,
  weight: 'low' | 'medium' | 'high',
): WeatherSignal {
  return {
    category:
      product.sourceId === 'rtma' || product.sourceId === 'urma'
        ? 'analysis'
        : product.sourceId === 'nbm'
          ? 'analysis'
          : 'guidance',
    weight,
    label: product.title,
    detail,
    sourceIds: [product.sourceId],
    productIds: [product.productId],
  }
}

function citationKindForSource(sourceId: string) {
  return sourceId === 'rtma' ? ('image' as const) : ('dataset' as const)
}

function buildShortRangeProducts() {
  return [
    {
      productId: 'hrrr',
      modelId: 'hrrr',
      title: 'HRRR',
      summary:
        'Use HRRR for storm-scale timing and convective evolution inside the next 18 hours.',
      url: hrrrUrl(),
      sourceId: 'hrrr',
      sourceName: 'HRRR',
    },
    {
      productId: 'rap',
      modelId: 'rap',
      title: 'RAP',
      summary:
        'Use RAP to sanity-check the evolving mesoscale environment and rapid-refresh short-range trends.',
      url: rapUrl(),
      sourceId: 'rap',
      sourceName: 'RAP',
    },
    {
      productId: 'nam',
      modelId: 'nam',
      title: 'NAM',
      summary:
        'Use NAM for short-range synoptic and mesoscale structure when comparing broader forcing and moisture placement.',
      url: namUrl(),
      sourceId: 'nam',
      sourceName: 'NAM',
    },
    {
      productId: 'nam-nest',
      modelId: 'nam-nest',
      title: 'NAM Nest',
      summary:
        'Use NAM Nest when you need a convection-allowing NAM family check on timing and storm mode.',
      url: namUrl(),
      sourceId: 'nam',
      sourceName: 'NAM',
    },
    {
      productId: 'href',
      modelId: 'href',
      title: 'HREF',
      summary:
        'Use HREF probabilities to represent the short-range spread and probability-style severe guidance better than a single deterministic run.',
      url: hrefUrl(),
      sourceId: 'href',
      sourceName: 'HREF',
    },
    {
      productId: 'nbm',
      modelId: 'nbm',
      title: 'National Blend of Models',
      summary:
        'Use NBM as the calibrated baseline for near-term sensible weather and precipitation timing.',
      url: blendUrl(),
      sourceId: 'nbm',
      sourceName: 'National Blend of Models',
    },
    {
      productId: 'rtma',
      modelId: 'rtma',
      title: 'RTMA',
      summary:
        'Use RTMA to anchor the current surface state before trusting a model trend for the next few hours.',
      url: rtmaUrl(),
      sourceId: 'rtma',
      sourceName: 'RTMA',
    },
    {
      productId: 'urma',
      modelId: 'urma',
      title: 'URMA',
      summary:
        'Use URMA as an analysis cross-check when the near-surface placement of boundaries or moisture matters.',
      url: urmaUrl(),
      sourceId: 'urma',
      sourceName: 'URMA',
    },
  ] satisfies Array<ModelProduct>
}

function buildGlobalProducts() {
  return [
    {
      productId: 'gfs',
      modelId: 'gfs',
      title: 'GFS',
      summary:
        'Use GFS for deterministic synoptic evolution and broad day 2 to day 10 pattern timing.',
      url: gfsUrl(),
      sourceId: 'gfs',
      sourceName: 'GFS',
    },
    {
      productId: 'gefs',
      modelId: 'gefs',
      title: 'GEFS',
      summary:
        'Use GEFS to describe ensemble spread and how stable the larger-scale pattern looks.',
      url: gefsUrl(),
      sourceId: 'gefs',
      sourceName: 'GEFS',
    },
  ] satisfies Array<ModelProduct>
}

function dedupeLabels(labels: Array<string>) {
  return [...new Set(labels.map((label) => label.trim()).filter(Boolean))]
}

function joinLabels(labels: Array<string>) {
  const deduped = dedupeLabels(labels)
  if (deduped.length === 0) {
    return ''
  }

  if (deduped.length === 1) {
    return deduped[0]
  }

  if (deduped.length === 2) {
    return `${deduped[0]} and ${deduped[1]}`
  }

  return `${deduped.slice(0, -1).join(', ')}, and ${deduped.at(-1)}`
}

export async function getShortRangeGuidance(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<ModelGuidanceData>> {
  const location = await geocodeQuery(app, locationQuery)
  const targets: Array<ModelTarget> = [
    {
      productId: 'href',
      modelId: 'href',
      title: 'HREF',
      summary:
        'Use HREF probabilities to represent the short-range spread and probability-style severe guidance better than a single deterministic run.',
      url: hrefUrl(),
      sourceId: 'href',
      sourceName: 'HREF',
      cacheKey: 'model:href',
    },
    {
      productId: 'hrrr',
      modelId: 'hrrr',
      title: 'HRRR',
      summary:
        'Use HRRR for storm-scale timing and convective evolution inside the next 18 hours.',
      url: hrrrUrl(),
      sourceId: 'hrrr',
      sourceName: 'HRRR',
      cacheKey: 'model:hrrr',
    },
    {
      productId: 'rap',
      modelId: 'rap',
      title: 'RAP',
      summary:
        'Use RAP to sanity-check the evolving mesoscale environment and rapid-refresh short-range trends.',
      url: rapUrl(),
      sourceId: 'rap',
      sourceName: 'RAP',
      cacheKey: 'model:rap',
    },
    {
      productId: 'nam',
      modelId: 'nam',
      title: 'NAM',
      summary:
        'Use NAM for short-range synoptic and mesoscale structure when comparing broader forcing and moisture placement.',
      url: namUrl(),
      sourceId: 'nam',
      sourceName: 'NAM',
      cacheKey: 'model:nam',
    },
    {
      productId: 'nbm',
      modelId: 'nbm',
      title: 'National Blend of Models',
      summary:
        'Use NBM as the calibrated baseline for near-term sensible weather and precipitation timing.',
      url: blendUrl(),
      sourceId: 'nbm',
      sourceName: 'National Blend of Models',
      cacheKey: 'model:blend',
    },
    {
      productId: 'rtma',
      modelId: 'rtma',
      title: 'RTMA',
      summary:
        'Use RTMA to anchor the current surface state before trusting a model trend for the next few hours.',
      url: rtmaUrl(),
      sourceId: 'rtma',
      sourceName: 'RTMA',
      cacheKey: 'model:rtma',
    },
    {
      productId: 'urma',
      modelId: 'urma',
      title: 'URMA',
      summary:
        'Use URMA as an analysis cross-check when the near-surface placement of boundaries or moisture matters.',
      url: urmaUrl(),
      sourceId: 'urma',
      sourceName: 'URMA',
      cacheKey: 'model:urma',
    },
  ]
  const results = await Promise.allSettled(
    targets.map((target) => loadModelTarget(app, target)),
  )
  const settled = settleModelTargets(targets, results)
  const successful = settled.successful
  const products = buildShortRangeProducts()
  const availableLabels = dedupeLabels(
    successful.map((entry) => entry.target.sourceName),
  )
  const confidence = Math.max(
    0.58,
    Math.min(0.88, 0.56 + successful.length * 0.04),
  )
  const missingSources = dedupeLabels(settled.missing)
  const headline =
    `For the next 0 to 48 hours around ${location.name}, lean on HREF probabilities and RTMA/URMA analysis first, then use HRRR, RAP, and NAM family guidance for timing details.`

  if (successful.length === 0) {
    throw new Error('Short-range guidance could not be fetched.')
  }

  return buildWeatherEnvelope({
    source: {
      sourceId: 'href',
      productId: 'short-range-guidance',
      label: 'Short-range guidance blend',
      url: hrefUrl(),
    },
    location,
    units: 'model-guidance',
    confidence,
    validAt: successful[0].retrievedAt,
    summary: availableLabels.length
      ? `Short-range guidance source context is available for ${location.name} from ${joinLabels(availableLabels)}. Use HREF for spread, HRRR and RAP for timing, and NAM family with NBM, RTMA, and URMA for baseline placement.`
      : `Short-range guidance context for ${location.name}.`,
    normalizedForecast: {
      domain: 'short-range-guidance',
      headline,
      mostLikelyScenario:
        'The most stable short-range call should come from an observation-calibrated blend: HREF for spread, HRRR and RAP for timing, NAM family for structure, and NBM/RTMA/URMA for baseline placement.',
      alternateScenarios: [
        'Deterministic timing can jump around if the boundary placement or instability axis shifts.',
      ],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals: [
        buildSignal(products[4], products[4].summary, 'high'),
        buildSignal(products[6], products[6].summary, 'high'),
        buildSignal(products[0], products[0].summary, 'medium'),
        buildSignal(products[1], products[1].summary, 'medium'),
        buildSignal(products[5], products[5].summary, 'medium'),
      ],
      conflicts: missingSources.length
        ? [
            `One or more short-range source products were unavailable: ${joinLabels(missingSources)}.`,
          ]
        : [],
      failureModes: [
        'Storm-scale timing can drift quickly when mesoscale boundaries are misplaced.',
        'A deterministic run should not be treated as the final answer when ensemble probabilities disagree.',
      ],
      whatWouldChange: [
        'A different placement of the effective boundary, instability axis, or convective initiation corridor would change the near-term target.',
      ],
      productCards: [
        productCard(products[4], 'primary'),
        productCard(products[0]),
        productCard(products[6]),
        productCard(products[5]),
      ],
      recommendedProductIds: ['href', 'hrrr', 'rtma', 'nbm'],
    },
    data: {
      products,
      notes: [
        'Short-range guidance is for timing and scenario support, not for reporting each model verbatim.',
        'Near-term answers should still be calibrated against current observations, radar, satellite, and analysis fields.',
        'Only concrete upstream products are surfaced; generic landing pages are omitted.',
      ],
      missingSources,
    },
    citations: successful.map((entry) => ({
      id: `${entry.target.sourceId}:${entry.target.productId}`,
      label: entry.target.sourceName,
      sourceId: entry.target.sourceId,
      productId: entry.target.productId,
      kind: citationKindForSource(entry.target.sourceId),
      url: entry.target.url,
      issuedAt: entry.retrievedAt,
    })),
  }) as WeatherEnvelope<ModelGuidanceData>
}

export async function getGlobalGuidance(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<ModelGuidanceData>> {
  const location = await geocodeQuery(app, locationQuery)
  const targets: Array<ModelTarget> = [
    {
      productId: 'gfs',
      modelId: 'gfs',
      title: 'GFS',
      summary:
        'Use GFS for deterministic synoptic evolution and broad day 2 to day 10 pattern timing.',
      url: gfsUrl(),
      sourceId: 'gfs',
      sourceName: 'GFS',
      cacheKey: 'model:gfs',
    },
    {
      productId: 'gefs',
      modelId: 'gefs',
      title: 'GEFS',
      summary:
        'Use GEFS to describe ensemble spread and how stable the larger-scale pattern looks.',
      url: gefsUrl(),
      sourceId: 'gefs',
      sourceName: 'GEFS',
      cacheKey: 'model:gefs',
    },
  ]
  const results = await Promise.allSettled(
    targets.map((target) => loadModelTarget(app, target)),
  )
  const settled = settleModelTargets(targets, results)
  const successful = settled.successful

  if (successful.length === 0) {
    throw new Error('Global guidance could not be fetched.')
  }

  const products = buildGlobalProducts()
  const availableLabels = dedupeLabels(
    successful.map((entry) => entry.target.sourceName),
  )
  const confidence = Math.max(0.56, Math.min(0.82, 0.58 + successful.length * 0.06))
  const missingSources = dedupeLabels([
    ...settled.missing,
    'ECMWF Open Data',
  ])
  const headline =
    `For day 2 to day 10 questions around ${location.name}, combine GFS and GEFS into one synoptic call instead of narrating each model separately.`

  return buildWeatherEnvelope({
    source: {
      sourceId: 'gfs',
      productId: 'global-guidance',
      label: 'Global guidance blend',
      url: gfsUrl(),
    },
    location,
    units: 'model-guidance',
    confidence,
    validAt: successful[0].retrievedAt,
    summary: availableLabels.length
      ? `Global guidance source context is available for ${location.name} from ${joinLabels(availableLabels)}. Use GEFS for spread and GFS for deterministic timing; ECMWF open data is unavailable as a concrete upstream product and is recorded as missing.`
      : `Global guidance context for ${location.name}.`,
    normalizedForecast: {
      domain: 'global-guidance',
      headline,
      mostLikelyScenario:
        'The most defensible medium-range answer is a single synoptic pattern call that uses GFS for deterministic evolution and GEFS for spread, while leaving ECMWF open data out until a direct product URL is available.',
      alternateScenarios: [
        'Confidence should drop quickly when GEFS spread widens or the deterministic timing trend slows or speeds up.',
      ],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals: [
        buildSignal(products[0], products[0].summary, 'medium'),
        buildSignal(products[1], products[1].summary, 'high'),
      ],
      conflicts: missingSources.length
        ? [
            `One or more global guidance source products were unavailable: ${joinLabels(missingSources)}.`,
          ]
        : [],
      failureModes: [
        'Medium-range confidence drops when ensemble spread grows or the trough/ridge timing slows or speeds up.',
      ],
      whatWouldChange: [
        'A larger change in GEFS spread or a meaningful timing difference in the deterministic run would change the pattern call.',
      ],
      productCards: [
        productCard(products[1], 'primary'),
        productCard(products[0]),
      ],
      recommendedProductIds: ['gefs', 'gfs'],
    },
    data: {
      products,
      notes: [
        'Global guidance should end in a single pattern judgment with uncertainty, not a side-by-side model report.',
        'Only concrete upstream products are surfaced; ECMWF open data is tracked as missing until a direct product URL is available.',
      ],
      missingSources,
    },
    citations: successful.map((entry) => ({
      id: `${entry.target.sourceId}:${entry.target.productId}`,
      label: entry.target.sourceName,
      sourceId: entry.target.sourceId,
      productId: entry.target.productId,
      kind: citationKindForSource(entry.target.sourceId),
      url: entry.target.url,
      issuedAt: entry.retrievedAt,
    })),
  }) as WeatherEnvelope<ModelGuidanceData>
}

export async function getShortRangeModelGuidance(
  app: FastifyInstance,
  locationQuery: string,
) {
  return getShortRangeGuidance(app, locationQuery)
}

export async function getBlendAndAnalysisGuidance(
  app: FastifyInstance,
  locationQuery: string,
) {
  return getShortRangeGuidance(app, locationQuery)
}

export async function getGlobalModelGuidance(
  app: FastifyInstance,
  locationQuery: string,
) {
  return getGlobalGuidance(app, locationQuery)
}
