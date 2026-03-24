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

type WpcProduct = {
  productId: string
  title: string
  summary: string
  url: string
  validRange?: {
    start: string
    end: string
  }
}

type WpcData = {
  products: Array<WpcProduct>
  notes: Array<string>
}

function qpfUrl() {
  return 'https://www.wpc.ncep.noaa.gov/qpf/colqpf.shtml'
}

function eroUrl() {
  return 'https://www.wpc.ncep.noaa.gov/qpf/excessive_rainfall_outlook_ero.php'
}

function winterUrl() {
  return 'https://www.wpc.ncep.noaa.gov/wwd/winter_wxbody.html'
}

function mediumRangeUrl() {
  return 'https://www.wpc.ncep.noaa.gov/medr/medr.html'
}

async function loadTextPage(
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

function extractWindow(text: string) {
  const match = text.match(/Valid\s+(.+?)\s+Through\s+(.+?)(?:\n|$)/i)
  if (!match?.[1] || !match[2]) {
    return undefined
  }

  return {
    start: match[1].trim(),
    end: match[2].trim(),
  }
}

export async function getWpcQpfEro(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<WpcData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [qpf, ero] = await Promise.all([
    loadTextPage(app, 'wpc', 'qpf', 'WPC QPF', qpfUrl(), 'wpc:qpf'),
    loadTextPage(app, 'wpc', 'ero', 'WPC ERO', eroUrl(), 'wpc:ero'),
  ])
  const qpfText = stripHtml(qpf.value)
  const eroText = stripHtml(ero.value)

  return buildWeatherEnvelope({
    source: qpf.source,
    location,
    units: 'inches',
    confidence: 0.8,
    validRange: extractWindow(eroText) ?? extractWindow(qpfText),
    summary:
      summarizeText(`${qpfText} ${eroText}`, 260) ||
      `WPC rainfall and excessive rainfall outlook context for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'wpc-qpf',
          title: 'WPC Quantitative Precipitation Forecast',
          summary: summarizeText(qpfText, 180),
          url: qpfUrl(),
          validRange: extractWindow(qpfText),
        },
        {
          productId: 'wpc-ero',
          title: 'WPC Excessive Rainfall Outlook',
          summary: summarizeText(eroText, 180),
          url: eroUrl(),
          validRange: extractWindow(eroText),
        },
      ],
      notes: [
        'QPF and ERO are the first-stop public sources for rainfall and flash-flood risk interpretation.',
        'Use NWPS and MRMS for river and precipitation confirmation when needed.',
      ],
    },
  })
}

export async function getWpcWinterWeather(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<WpcData>> {
  const location = await geocodeQuery(app, locationQuery)
  const page = await loadTextPage(
    app,
    'wpc',
    'winter-weather',
    'WPC Winter Weather',
    winterUrl(),
    'wpc:winter',
  )
  const text = stripHtml(page.value)

  return buildWeatherEnvelope({
    source: page.source,
    location,
    units: 'inches',
    confidence: 0.77,
    summary:
      summarizeText(text, 240) ||
      `Winter-weather probabilistic guidance for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'wpc-snowfall-probability',
          title: 'WPC Snowfall Probability Forecasts',
          summary:
            'WPC winter weather pages provide probabilistic snowfall forecasts for Days 1-3.',
          url: winterUrl(),
        },
        {
          productId: 'wpc-freezing-rain-probability',
          title: 'WPC Freezing-Rain Probability Forecasts',
          summary:
            'The same WPC winter weather page provides freezing-rain probabilities for Days 1-3.',
          url: winterUrl(),
        },
      ],
      notes: [
        'Winter-weather probability graphics are best paired with the official NWS forecast and local warnings.',
      ],
    },
  })
}

export async function getWpcMediumRangeHazards(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<WpcData>> {
  const location = await geocodeQuery(app, locationQuery)
  const page = await loadTextPage(
    app,
    'wpc',
    'medium-range',
    'WPC Medium Range',
    mediumRangeUrl(),
    'wpc:medium-range',
  )
  const text = stripHtml(page.value)

  return buildWeatherEnvelope({
    source: page.source,
    location,
    units: 'categorical',
    confidence: 0.72,
    summary:
      summarizeText(text, 240) ||
      `WPC medium-range hazards guidance for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'wpc-day3-7-hazards',
          title: 'WPC Day 3-7 Hazards',
          summary:
            'The WPC medium-range page highlights national impacts, surface features, and key-message hazards.',
          url: mediumRangeUrl(),
        },
        {
          productId: 'wpc-day3-7-heights',
          title: 'WPC 500-mb Height and Surface System Guidance',
          summary:
            'Medium-range forecast maps include 500-mb heights, surface systems, and related discussion text.',
          url: mediumRangeUrl(),
        },
      ],
      notes: [
        'Medium-range hazards are best interpreted together with GFS, GEFS, and ECMWF comparison tools.',
      ],
    },
  })
}
