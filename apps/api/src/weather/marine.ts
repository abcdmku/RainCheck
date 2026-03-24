import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherText,
  stripHtml,
  summarizeText,
  type WeatherEnvelope,
} from './runtime'

type MarineProduct = {
  productId: string
  title: string
  summary: string
  url: string
}

type MarineData = {
  products: Array<MarineProduct>
  notes: Array<string>
}

function waveUrl() {
  return 'https://www.nco.ncep.noaa.gov/pmb/products/wave/'
}

function rtofsUrl() {
  return 'https://www.nco.ncep.noaa.gov/pmb/products/rtofs/'
}

async function loadMarinePage(app: FastifyInstance, url: string, key: string, label: string) {
  return fetchWeatherText(app, {
    sourceId: 'marine',
    productId: key,
    label,
    url,
    cacheKey: cacheKey('marine', key),
    ttlMs: 10 * 60 * 1000,
  })
}

export async function getMarineOceanGuidance(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<MarineData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [wave, rtofs] = await Promise.all([
    loadMarinePage(app, waveUrl(), 'wave-models', 'NCEP wave models'),
    loadMarinePage(app, rtofsUrl(), 'rtofs', 'RTOFS'),
  ])
  const text = stripHtml(`${wave.value} ${rtofs.value}`)

  return buildWeatherEnvelope({
    source: wave.source,
    location,
    units: 'wave-height/current',
    confidence: 0.69,
    summary:
      summarizeText(text, 250) ||
      `Marine guidance for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'wavewatch-iii',
          title: 'WaveWatch III',
          summary:
            'The NCEP wave products page summarizes wave guidance used for routing and swell analysis.',
          url: waveUrl(),
        },
        {
          productId: 'rtofs',
          title: 'RTOFS',
          summary:
            'RTOFS provides operational ocean nowcast and forecast context for marine routing.',
          url: rtofsUrl(),
        },
      ],
      notes: [
        'Wave and ocean guidance are intentionally kept as page-level summaries until raster and subset parsers are added.',
      ],
    },
  })
}
