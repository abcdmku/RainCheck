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

type RadarProduct = {
  productId: string
  title: string
  summary: string
  url: string
}

type RadarData = {
  products: Array<RadarProduct>
  notes: Array<string>
}

function nexradInfoUrl() {
  return 'https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar'
}

function radarGuideUrl() {
  return 'https://www.weather.gov/jetstream/radar'
}

async function loadRadarPage(app: FastifyInstance, url: string, key: string, label: string) {
  return fetchWeatherText(app, {
    sourceId: 'nexrad',
    productId: key,
    label,
    url,
    cacheKey: cacheKey('nexrad', key),
    ttlMs: 10 * 60 * 1000,
  })
}

export async function getNexradRadar(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<RadarData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [nexrad, guide] = await Promise.all([
    loadRadarPage(app, nexradInfoUrl(), 'nexrad-info', 'NEXRAD product page'),
    loadRadarPage(app, radarGuideUrl(), 'radar-guide', 'Radar guide'),
  ])
  const text = stripHtml(`${nexrad.value} ${guide.value}`)

  return buildWeatherEnvelope({
    source: nexrad.source,
    location,
    units: 'reflectivity/velocity',
    confidence: 0.74,
    summary:
      summarizeText(text, 250) ||
      `Radar context for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'nexrad-public-data',
          title: 'NEXRAD public data',
          summary:
            'NEXRAD public-data pages describe the radar archive and scan products used for nowcasting.',
          url: nexradInfoUrl(),
        },
        {
          productId: 'radar-guide',
          title: 'Radar interpretation guide',
          summary:
            'The radar guide supports storm-structure interpretation and loop reasoning.',
          url: radarGuideUrl(),
        },
      ],
      notes: [
        'This connector intentionally starts with metadata and guide pages before binary radar decoding is added.',
      ],
    },
  })
}
