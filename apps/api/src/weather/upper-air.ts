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

type UpperAirProduct = {
  productId: string
  title: string
  summary: string
  url: string
}

type UpperAirData = {
  products: Array<UpperAirProduct>
  notes: Array<string>
}

function soundingUrl() {
  return 'https://www.weather.gov/upperair/sounding'
}

function archiveUrl() {
  return 'https://www.spc.noaa.gov/exper/soundings/'
}

async function loadUpperAirPage(app: FastifyInstance, url: string, key: string, label: string) {
  return fetchWeatherText(app, {
    sourceId: 'upper-air',
    productId: key,
    label,
    url,
    cacheKey: cacheKey('upper-air', key),
    ttlMs: 10 * 60 * 1000,
  })
}

export async function getUpperAirSoundings(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<UpperAirData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [sounding, archive] = await Promise.all([
    loadUpperAirPage(app, soundingUrl(), 'nws-sounding', 'NWS upper-air sounding'),
    loadUpperAirPage(app, archiveUrl(), 'spc-sounding-archive', 'SPC sounding archive'),
  ])
  const text = stripHtml(`${sounding.value} ${archive.value}`)

  return buildWeatherEnvelope({
    source: sounding.source,
    location,
    units: 'soundings',
    confidence: 0.68,
    summary:
      summarizeText(text, 250) ||
      `Upper-air sounding context for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'nws-upper-air-sounding',
          title: 'NWS upper-air sounding',
          summary:
            'The NWS sounding page supports observed radiosonde interpretation and station access.',
          url: soundingUrl(),
        },
        {
          productId: 'spc-sounding-archive',
          title: 'SPC sounding archive',
          summary:
            'The SPC archive supports recent sounding review and Skew-T teaching workflows.',
          url: archiveUrl(),
        },
      ],
      notes: [
        'This connector is intended to feed future Skew-T and CAPE/shear artifact generation.',
      ],
    },
  })
}
