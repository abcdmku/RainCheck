import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherText,
  type WeatherEnvelope,
} from './runtime'

type MrmsProduct = {
  productId: string
  title: string
  summary: string
  url: string
}

type MrmsData = {
  products: Array<MrmsProduct>
  notes: Array<string>
}

function mrmsInfoUrl() {
  return 'https://www.drought.gov/data-maps-tools/multi-radar-multi-sensor-system-mrms'
}

function mrmsGuideUrl() {
  return 'https://www.nssl.noaa.gov/projects/mrms/'
}

async function loadMrmsPage(app: FastifyInstance, url: string, key: string, label: string) {
  return fetchWeatherText(app, {
    sourceId: 'mrms',
    productId: key,
    label,
    url,
    cacheKey: cacheKey('mrms', key),
    ttlMs: 10 * 60 * 1000,
  })
}

export async function getMrmsProducts(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<MrmsData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [mrms, guide] = await Promise.all([
    loadMrmsPage(app, mrmsInfoUrl(), 'mrms-info', 'MRMS product page'),
    loadMrmsPage(app, mrmsGuideUrl(), 'mrms-guide', 'MRMS guide'),
  ])
  void guide

  return buildWeatherEnvelope({
    source: mrms.source,
    location,
    units: 'qpe/reflectivity',
    confidence: 0.7,
    summary: `MRMS context is available for ${location.name} and supports near-real-time radar composite and precipitation analysis.`,
    data: {
      products: [
        {
          productId: 'mrms-public-data',
          title: 'MRMS public data',
          summary:
            'MRMS multi-sensor analysis and QPE descriptions are exposed in public data pages and support precipitation analysis.',
          url: mrmsInfoUrl(),
        },
        {
          productId: 'mrms-project-guide',
          title: 'MRMS project guide',
          summary:
            'The NSSL MRMS project page explains the hail, wind, tornado, icing, and turbulence use cases.',
          url: mrmsGuideUrl(),
        },
      ],
      notes: [
        'MRMS is best used as near-real-time radar-composite and precipitation-analysis context.',
      ],
    },
  })
}
