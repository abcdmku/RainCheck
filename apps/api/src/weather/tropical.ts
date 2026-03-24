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

type TropicalProduct = {
  productId: string
  title: string
  summary: string
  url: string
}

type TropicalData = {
  products: Array<TropicalProduct>
  notes: Array<string>
}

function tropicalOutlookUrl() {
  return 'https://www.nhc.noaa.gov/gtwo.php'
}

function tropicalProductsUrl() {
  return 'https://www.nhc.noaa.gov/aboutnhcprod.shtml'
}

async function loadTropicalPage(
  app: FastifyInstance,
  url: string,
  key: string,
  label: string,
) {
  return fetchWeatherText(app, {
    sourceId: 'nhc',
    productId: key,
    label,
    url,
    cacheKey: cacheKey('nhc', key),
    ttlMs: 10 * 60 * 1000,
  })
}

export async function getTropicalWeather(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<TropicalData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [outlook, products] = await Promise.all([
    loadTropicalPage(
      app,
      tropicalOutlookUrl(),
      'tropical-weather-outlook',
      'NHC Tropical Weather Outlook',
    ),
    loadTropicalPage(
      app,
      tropicalProductsUrl(),
      'tropical-product-guide',
      'NHC product guide',
    ),
  ])
  const text = stripHtml(`${outlook.value} ${products.value}`)

  return buildWeatherEnvelope({
    source: outlook.source,
    location,
    units: 'categorical',
    confidence: 0.8,
    summary:
      summarizeText(text, 260) ||
      `Tropical-weather outlook context for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'nhc-tropical-weather-outlook',
          title: 'NHC Tropical Weather Outlook',
          summary:
            'The NHC tropical weather outlook is updated routinely during the season and supports 2-day and 7-day formation questions.',
          url: tropicalOutlookUrl(),
        },
        {
          productId: 'nhc-tropical-products',
          title: 'NHC product guide',
          summary:
            'The NHC product guide summarizes advisories, cones, watches, warnings, and GIS feeds.',
          url: tropicalProductsUrl(),
        },
      ],
      notes: [
        'For an active system, the next step is to add storm-specific advisory parsing and cone products.',
      ],
    },
  })
}
