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

type SatelliteProduct = {
  productId: string
  title: string
  summary: string
  url: string
}

type SatelliteData = {
  products: Array<SatelliteProduct>
  notes: Array<string>
}

function goesInfoUrl() {
  return 'https://www.ncei.noaa.gov/products/goes-terrestrial-weather-abi-glm'
}

function satelliteGuideUrl() {
  return 'https://www.weather.gov/sat'
}

async function loadSatellitePage(
  app: FastifyInstance,
  url: string,
  key: string,
  label: string,
) {
  return fetchWeatherText(app, {
    sourceId: 'goes',
    productId: key,
    label,
    url,
    cacheKey: cacheKey('goes', key),
    ttlMs: 10 * 60 * 1000,
  })
}

export async function getGoesSatellite(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<SatelliteData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [goes, guide] = await Promise.all([
    loadSatellitePage(app, goesInfoUrl(), 'goes-info', 'GOES product page'),
    loadSatellitePage(app, satelliteGuideUrl(), 'satellite-guide', 'Satellite guide'),
  ])
  const text = stripHtml(`${goes.value} ${guide.value}`)

  return buildWeatherEnvelope({
    source: goes.source,
    location,
    units: 'imagery',
    confidence: 0.74,
    summary:
      summarizeText(text, 250) ||
      `Satellite context for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'goes-abi-glm',
          title: 'GOES ABI / GLM',
          summary:
            'GOES ABI and GLM public-data pages describe the visible, infrared, water-vapor, and lightning products used in convection analysis.',
          url: goesInfoUrl(),
        },
        {
          productId: 'satellite-guide',
          title: 'Satellite interpretation guide',
          summary:
            'The satellite guide supports cloud-top, smoke, fog, and water-vapor interpretation.',
          url: satelliteGuideUrl(),
        },
      ],
      notes: [
        'This connector starts with the official product descriptions before loop generation is added.',
      ],
    },
  })
}
