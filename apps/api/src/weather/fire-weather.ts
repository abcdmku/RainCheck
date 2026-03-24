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

type FireWeatherData = {
  outlooks: Array<{
    productId: string
    title: string
    summary: string
    url: string
  }>
  notes: Array<string>
}

function fireWeatherUrl() {
  return 'https://www.weather.gov/fire'
}

async function loadFirePage(app: FastifyInstance) {
  return fetchWeatherText(app, {
    sourceId: 'weather-gov',
    productId: 'fire-weather',
    label: 'National Fire Weather page',
    url: fireWeatherUrl(),
    cacheKey: cacheKey('fire-weather', 'page'),
    ttlMs: 10 * 60 * 1000,
  })
}

export async function getFireWeatherProducts(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<FireWeatherData>> {
  const location = await geocodeQuery(app, locationQuery)
  const page = await loadFirePage(app)
  const text = stripHtml(page.value)

  return buildWeatherEnvelope({
    source: page.source,
    location,
    units: 'categorical',
    confidence: 0.72,
    validAt: page.retrievedAt,
    summary:
      summarizeText(text, 220) ||
      `Fire weather outlook context for ${location.name}.`,
    data: {
      outlooks: [
        {
          productId: 'spc-day1-fire-weather',
          title: 'SPC Fire Weather Day 1',
          summary:
            'Use the national fire page for current SPC fire outlook links and narrative context.',
          url: fireWeatherUrl(),
        },
        {
          productId: 'spc-day2-fire-weather',
          title: 'SPC Fire Weather Day 2',
          summary:
            'The fire page also surfaces the day 2 outlook and related local fire-weather resources.',
          url: fireWeatherUrl(),
        },
        {
          productId: 'spc-day3-8-fire-weather',
          title: 'SPC Fire Weather Day 3-8',
          summary:
            'Longer-range fire-weather outlook context is available from the same national fire page.',
          url: fireWeatherUrl(),
        },
      ],
      notes: [
        'SPC fire-weather links are surfaced from the national NWS fire weather page.',
        'For operational use, treat this as outlook context rather than a point forecast.',
      ],
    },
  })
}
