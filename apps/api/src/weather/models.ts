import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import { previewFromArtifact } from './previews'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherText,
  stripHtml,
  summarizeText,
  type WeatherEnvelope,
} from './runtime'
import { generateArtifact } from './service-client'

type ModelProduct = {
  productId: string
  modelId: string
  title: string
  summary: string
  url: string
}

type ModelGuidanceData = {
  products: Array<ModelProduct>
  notes: Array<string>
}

function nomadsUrl() {
  return 'https://nomads.ncep.noaa.gov/'
}

function blendUrl() {
  return 'https://www.nco.ncep.noaa.gov/pmb/products/blend/'
}

function rtmaUrl() {
  return 'https://www.nco.ncep.noaa.gov/pmb/products/rtma/'
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

async function buildModelPreview(
  app: FastifyInstance,
  locationName: string,
  prompt: string,
  models: Array<{
    sourceId: string
    modelLabel: string
    summary: string
    cycleTime?: string
    validTime?: string
    confidence?: string
  }>,
) {
  const previewArtifact = await generateArtifact(app, {
    artifactType: 'model-comparison-panel',
    locationQuery: locationName,
    prompt,
    comparisonModels: models,
  })
  const artifactHandle = {
    artifactId: previewArtifact.artifactId,
    type: String(previewArtifact.type),
    title: previewArtifact.title,
    href: previewArtifact.href,
    mimeType: previewArtifact.mimeType,
  }

  return {
    artifacts: [artifactHandle],
    ...previewFromArtifact(
      artifactHandle,
      `Model guidance comparison panel for ${locationName}`,
    ),
  }
}

export async function getShortRangeModelGuidance(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<ModelGuidanceData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [hrrr, rap, nam, href] = await Promise.all([
    loadModelPage(app, 'hrrr', 'hrrr', 'HRRR', nomadsUrl(), 'model:hrrr'),
    loadModelPage(app, 'rap', 'rap', 'RAP', nomadsUrl(), 'model:rap'),
    loadModelPage(app, 'nam', 'nam', 'NAM', nomadsUrl(), 'model:nam'),
    loadModelPage(app, 'href', 'href', 'HREF', nomadsUrl(), 'model:href'),
  ])
  const text = stripHtml(
    `${hrrr.value} ${rap.value} ${nam.value} ${href.value}`,
  )
  const products = [
    {
      productId: 'hrrr',
      modelId: 'hrrr',
      title: 'HRRR',
      summary:
        'Hourly HRRR guidance is distributed through NOMADS and the NCO product inventory.',
      url: nomadsUrl(),
    },
    {
      productId: 'rap',
      modelId: 'rap',
      title: 'RAP',
      summary:
        'RAP guidance is exposed through NOMADS as rapid-refresh short-range guidance.',
      url: nomadsUrl(),
    },
    {
      productId: 'nam',
      modelId: 'nam',
      title: 'NAM / NAM Nest',
      summary: 'NAM family guidance is listed in the public NOMADS inventory.',
      url: nomadsUrl(),
    },
    {
      productId: 'href',
      modelId: 'href',
      title: 'HREF',
      summary:
        'The HREF ensemble is part of the public NOMADS model inventory.',
      url: nomadsUrl(),
    },
  ]
  const preview = await buildModelPreview(
    app,
    location.name,
    `Short-range model guidance snapshot for ${location.name}`,
    products.map((product) => ({
      sourceId: product.modelId,
      modelLabel: product.title,
      summary: product.summary,
    })),
  )

  return buildWeatherEnvelope({
    source: hrrr.source,
    location,
    units: 'model-guidance',
    confidence: 0.6,
    summary:
      summarizeText(text, 260) ||
      `Short-range model guidance for ${location.name}.`,
    ...preview,
    data: {
      products,
      notes: [
        'These public pages expose the operational model families and their access points.',
        'The next step is to add targeted gridded subset extraction for timing-sensitive answers.',
      ],
    },
  })
}

export async function getBlendAndAnalysisGuidance(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<ModelGuidanceData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [blend, rtma] = await Promise.all([
    loadModelPage(
      app,
      'nbm',
      'nbm',
      'National Blend of Models',
      blendUrl(),
      'model:blend',
    ),
    loadModelPage(app, 'rtma', 'rtma', 'RTMA / URMA', rtmaUrl(), 'model:rtma'),
  ])
  const text = stripHtml(`${blend.value} ${rtma.value}`)
  const products = [
    {
      productId: 'nbm',
      modelId: 'nbm',
      title: 'National Blend of Models',
      summary:
        "NBM provides NOAA's calibrated blend of model guidance for near-term weather.",
      url: blendUrl(),
    },
    {
      productId: 'rtma',
      modelId: 'rtma',
      title: 'RTMA / URMA',
      summary: 'RTMA and URMA provide near-real-time surface analysis fields.',
      url: rtmaUrl(),
    },
  ]
  const preview = await buildModelPreview(
    app,
    location.name,
    `Blend and analysis snapshot for ${location.name}`,
    products.map((product) => ({
      sourceId: product.modelId,
      modelLabel: product.title,
      summary: product.summary,
    })),
  )

  return buildWeatherEnvelope({
    source: blend.source,
    location,
    units: 'analysis',
    confidence: 0.63,
    summary:
      summarizeText(text, 240) ||
      `Blend and analysis guidance for ${location.name}.`,
    ...preview,
    data: {
      products,
      notes: [
        'Blend and analysis guidance should be used before pure model summaries when answering near-term surface questions.',
      ],
    },
  })
}

export async function getGlobalModelGuidance(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<ModelGuidanceData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [gfs, gefs, ecmwf] = await Promise.all([
    loadModelPage(app, 'gfs', 'gfs', 'GFS', nomadsUrl(), 'model:gfs'),
    loadModelPage(app, 'gefs', 'gefs', 'GEFS', nomadsUrl(), 'model:gefs'),
    loadModelPage(
      app,
      'ecmwf-open-data',
      'ecmwf-open-data',
      'ECMWF Open Data',
      ecmwfOpenDataUrl(),
      'model:ecmwf',
    ),
  ])
  const text = stripHtml(`${gfs.value} ${gefs.value} ${ecmwf.value}`)
  const products = [
    {
      productId: 'gfs',
      modelId: 'gfs',
      title: 'GFS',
      summary:
        'The public NOMADS inventory exposes the global forecast system.',
      url: nomadsUrl(),
    },
    {
      productId: 'gefs',
      modelId: 'gefs',
      title: 'GEFS',
      summary:
        'The global ensemble forecast system is also available through NOMADS.',
      url: nomadsUrl(),
    },
    {
      productId: 'ecmwf-open-data',
      modelId: 'ecmwf-open-data',
      title: 'ECMWF Open Data',
      summary:
        'ECMWF open data provides free access to a public subset of IFS and AIFS forecasts.',
      url: ecmwfOpenDataUrl(),
    },
  ]
  const preview = await buildModelPreview(
    app,
    location.name,
    `Global model guidance snapshot for ${location.name}`,
    products.map((product) => ({
      sourceId: product.modelId,
      modelLabel: product.title,
      summary: product.summary,
    })),
  )

  return buildWeatherEnvelope({
    source: gfs.source,
    location,
    units: 'model-guidance',
    confidence: 0.58,
    summary:
      summarizeText(text, 260) || `Global model guidance for ${location.name}.`,
    ...preview,
    data: {
      products,
      notes: [
        'Use this tool for days 2-10 synoptic questions and compare against WPC hazards when needed.',
      ],
    },
  })
}

export type ModelComparisonInput = Array<{
  sourceId: string
  modelLabel: string
  runTime: string
  validTime: string
  summary: string
}>

export function compareModels(
  locationName: string,
  comparedModels: ModelComparisonInput,
) {
  const modelNames = comparedModels.map((model) => model.modelLabel).join(', ')
  return {
    locationName,
    comparedModels,
    consensus:
      comparedModels.length > 0
        ? `Compared ${modelNames} for ${locationName}.`
        : `No model guidance was available for ${locationName}.`,
    uncertainty:
      comparedModels.length > 1
        ? 'Model spread should be interpreted directly from the source guidance and not inferred from a single deterministic page.'
        : 'A single model family cannot establish meaningful spread on its own.',
  }
}
