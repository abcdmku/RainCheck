import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherText,
  firstNonEmptyLine,
  stripHtml,
  summarizeText,
  type WeatherEnvelope,
} from './runtime'

type SpcProduct = {
  productId: string
  title: string
  summary: string
  url: string
  validRange?: {
    start: string
    end: string
  }
}

type SpcSevereData = {
  products: Array<SpcProduct>
  watchContext: string
  mesoscaleContext: string
}

function parseValidRange(text: string) {
  const match = text.match(
    /Valid\s+(.+?\d{4})\s+Through\s+(.+?\d{4})(?:\s+[A-Z][\s\S]*|$)/i,
  )
  if (!match?.[1] || !match[2]) {
    return undefined
  }

  return {
    start: match[1].trim(),
    end: match[2].trim(),
  }
}

function severePageUrl() {
  return 'https://www.weather.gov/hun/severe'
}

async function loadSeverePage(app: FastifyInstance) {
  return fetchWeatherText(app, {
    sourceId: 'spc',
    productId: 'severe-weather-page',
    label: 'SPC severe weather page',
    url: severePageUrl(),
    cacheKey: cacheKey('spc', 'severe', 'page'),
    ttlMs: 10 * 60 * 1000,
  })
}

export async function getSpcSevereProducts(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<SpcSevereData>> {
  const location = await geocodeQuery(app, locationQuery)
  const severePage = await loadSeverePage(app)
  const severeText = stripHtml(severePage.value)
  const validRange = parseValidRange(severeText)
  const day1 = firstNonEmptyLine(severeText) || 'SPC severe outlook context page'

  return buildWeatherEnvelope({
    source: severePage.source,
    location,
    units: 'categorical',
    confidence: 0.78,
    validRange,
    summary:
      summarizeText(severeText, 240) ||
      `Severe-weather outlook context for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'spc-day1-convective-outlook',
          title: 'SPC Day 1 Convective Outlook',
          summary: day1,
          url: severePageUrl(),
          validRange,
        },
        {
          productId: 'spc-day2-convective-outlook',
          title: 'SPC Day 2 Convective Outlook',
          summary:
            'The national severe-weather page surfaces current day 2 outlook links.',
          url: severePageUrl(),
        },
        {
          productId: 'spc-day3-8-convective-outlook',
          title: 'SPC Day 3-8 Convective Outlook',
          summary:
            'Broader severe-weather context and mesoscale discussion links are available on the same page.',
          url: severePageUrl(),
        },
      ],
      watchContext:
        'Use the SPC severe-weather page together with NWS active alerts for watch status and local hazards.',
      mesoscaleContext:
        'Mesoscale discussion links are exposed alongside outlooks on the NWS severe-weather page.',
    },
  })
}
