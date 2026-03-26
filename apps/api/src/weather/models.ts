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

type ModelGuidanceData = {
  products: Array<ModelProduct>
  notes: Array<string>
  missingSources: Array<string>
}

function hrrrUrl() {
  return 'https://nomads.ncep.noaa.gov/gribfilter.php?ds=hrrr_2d'
}

function rapUrl() {
  return 'https://nomads.ncep.noaa.gov/gribfilter.php?ds=rap32'
}

function namUrl() {
  return 'https://nomads.ncep.noaa.gov/gribfilter.php?ds=nam'
}

function hrefUrl() {
  return 'https://nomads.ncep.noaa.gov/gribfilter.php?ds=hrefconus'
}

function blendUrl() {
  return 'https://nomads.ncep.noaa.gov/gribfilter.php?ds=blend'
}

function rtmaUrl() {
  return 'https://nomads.ncep.noaa.gov/gribfilter.php?ds=rtma2p5'
}

function urmaUrl() {
  return 'https://www.nco.ncep.noaa.gov/pmb/products/urma/'
}

function gfsUrl() {
  return 'https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_0p25'
}

function gefsUrl() {
  return 'https://nomads.ncep.noaa.gov/gribfilter.php?ds=gefs_atmos_0p25s'
}

function ecmwfOpenDataUrl() {
  return 'https://www.ecmwf.int/en/forecasts/datasets/open-data'
}

async function loadModelPage(
  app: FastifyInstance,
  sourceId: string,
  productId: string,
  label: string,
  url: string,
  cacheName: string,
) {
  return fetchWeatherText(app, {
    sourceId,
    productId,
    label,
    url,
    cacheKey: cacheKey(cacheName),
    ttlMs: 10 * 60 * 1000,
  })
}

function settledFailures(
  results: Array<PromiseSettledResult<Awaited<ReturnType<typeof loadModelPage>>>>,
) {
  return results.flatMap((result) => {
    if (result.status === 'fulfilled') {
      return []
    }

    const message =
      result.reason instanceof Error ? result.reason.message : String(result.reason)
    return [message]
  })
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
    {
      productId: 'ecmwf-open-data',
      modelId: 'ecmwf-open-data',
      title: 'ECMWF Open Data',
      summary:
        'Use ECMWF open data as the external global comparison point for the day 2 to day 10 synoptic call.',
      url: ecmwfOpenDataUrl(),
      sourceId: 'ecmwf-open-data',
      sourceName: 'ECMWF Open Data',
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
  const results = await Promise.allSettled([
    loadModelPage(
      app,
      'href',
      'href',
      'HREF',
      hrefUrl(),
      'model:href',
    ),
    loadModelPage(
      app,
      'hrrr',
      'hrrr',
      'HRRR',
      hrrrUrl(),
      'model:hrrr',
    ),
    loadModelPage(
      app,
      'rap',
      'rap',
      'RAP',
      rapUrl(),
      'model:rap',
    ),
    loadModelPage(
      app,
      'nam',
      'nam',
      'NAM',
      namUrl(),
      'model:nam',
    ),
    loadModelPage(
      app,
      'nbm',
      'national-blend-of-models',
      'National Blend of Models',
      blendUrl(),
      'model:blend',
    ),
    loadModelPage(
      app,
      'rtma',
      'real-time-mesoscale-analysis',
      'RTMA',
      rtmaUrl(),
      'model:rtma',
    ),
    loadModelPage(
      app,
      'urma',
      'unrestricted-mesoscale-analysis',
      'URMA',
      urmaUrl(),
      'model:urma',
    ),
  ])

  const successful = results
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof loadModelPage>>
      > => result.status === 'fulfilled',
    )
    .map((result) => result.value)

  if (successful.length === 0) {
    throw new Error('Short-range guidance could not be fetched.')
  }

  const products = buildShortRangeProducts()
  const availableLabels = dedupeLabels(successful.map((entry) => entry.source.label))
  const confidence = Math.max(0.58, Math.min(0.88, 0.56 + successful.length * 0.04))
  const missingSources = settledFailures(results)
  const headline =
    `For the next 0 to 48 hours around ${location.name}, lean on HREF probabilities and RTMA/URMA analysis first, then use HRRR, RAP, and NAM family guidance for timing details.`

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
        ? ['One or more short-range source pages were unavailable, so the guidance set is less complete than ideal.']
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
      ],
      missingSources,
    },
    citations: successful.map((entry) => ({
      id: `${entry.source.sourceId}:${entry.source.productId}`,
      label: entry.source.label,
      sourceId: entry.source.sourceId,
      productId: entry.source.productId,
      url: entry.source.url,
      issuedAt: entry.retrievedAt,
    })),
  })
}

export async function getGlobalGuidance(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<ModelGuidanceData>> {
  const location = await geocodeQuery(app, locationQuery)
  const results = await Promise.allSettled([
    loadModelPage(app, 'gfs', 'gfs', 'GFS', gfsUrl(), 'model:gfs'),
    loadModelPage(app, 'gefs', 'gefs', 'GEFS', gefsUrl(), 'model:gefs'),
    loadModelPage(
      app,
      'ecmwf-open-data',
      'ecmwf-open-data',
      'ECMWF Open Data',
      ecmwfOpenDataUrl(),
      'model:ecmwf-open-data',
    ),
  ])

  const successful = results
    .filter(
      (
        result,
      ): result is PromiseFulfilledResult<
        Awaited<ReturnType<typeof loadModelPage>>
      > => result.status === 'fulfilled',
    )
    .map((result) => result.value)

  if (successful.length === 0) {
    throw new Error('Global guidance could not be fetched.')
  }

  const products = buildGlobalProducts()
  const availableLabels = dedupeLabels(successful.map((entry) => entry.source.label))
  const confidence = Math.max(0.56, Math.min(0.82, 0.58 + successful.length * 0.06))
  const missingSources = settledFailures(results)
  const headline =
    `For day 2 to day 10 questions around ${location.name}, combine GFS and GEFS with ECMWF open data into one synoptic call instead of narrating each model separately.`

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
      ? `Global guidance source context is available for ${location.name} from ${joinLabels(availableLabels)}. Use GEFS for spread, GFS for deterministic timing, and ECMWF open data as the broader pattern cross-check.`
      : `Global guidance context for ${location.name}.`,
    normalizedForecast: {
      domain: 'global-guidance',
      headline,
      mostLikelyScenario:
        'The most defensible medium-range answer is a single synoptic pattern call that uses GFS for deterministic evolution, GEFS for spread, and ECMWF open data for cross-model confirmation.',
      alternateScenarios: [
        'Confidence should drop quickly when GEFS spread widens or the ECMWF and GFS pattern timing diverge.',
      ],
      likelihood: confidenceLevel(confidence),
      confidence: confidenceLevel(confidence),
      keySignals: [
        buildSignal(products[0], products[0].summary, 'medium'),
        buildSignal(products[1], products[1].summary, 'high'),
        buildSignal(products[2], products[2].summary, 'high'),
      ],
      conflicts: missingSources.length
        ? ['One or more global guidance sources were unavailable, so the day 2 to day 10 comparison is less complete.']
        : [],
      failureModes: [
        'Medium-range confidence drops when ensemble spread grows or the trough/ridge timing slows or speeds up.',
      ],
      whatWouldChange: [
        'A larger change in GEFS spread or a meaningful timing difference between GFS and ECMWF would change the pattern call.',
      ],
      productCards: [
        productCard(products[2], 'primary'),
        productCard(products[1]),
        productCard(products[0]),
      ],
      recommendedProductIds: ['ecmwf-open-data', 'gefs', 'gfs'],
    },
    data: {
      products,
      notes: [
        'Global guidance should end in a single pattern judgment with uncertainty, not a side-by-side model report.',
      ],
      missingSources,
    },
    citations: successful.map((entry) => ({
      id: `${entry.source.sourceId}:${entry.source.productId}`,
      label: entry.source.label,
      sourceId: entry.source.sourceId,
      productId: entry.source.productId,
      url: entry.source.url,
      issuedAt: entry.retrievedAt,
    })),
  })
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
