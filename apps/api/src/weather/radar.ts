import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherJson,
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
  imageUrl?: string
}

type RadarData = {
  products: Array<RadarProduct>
  notes: Array<string>
  radarStation?: string
  loopUrl?: string
  latestFrameUrl?: string
}

type PointsResponse = {
  properties?: {
    radarStation?: string
  }
}

function nexradInfoUrl() {
  return 'https://www.ncei.noaa.gov/products/radar/next-generation-weather-radar'
}

function radarGuideUrl() {
  return 'https://www.weather.gov/jetstream/radar'
}

async function loadRadarPage(
  app: FastifyInstance,
  url: string,
  key: string,
  label: string,
) {
  return fetchWeatherText(app, {
    sourceId: 'nexrad',
    productId: key,
    label,
    url,
    cacheKey: cacheKey('nexrad', key),
    ttlMs: 10 * 60 * 1000,
  })
}

async function loadRadarStation(
  app: FastifyInstance,
  latitude: number,
  longitude: number,
) {
  const pointsUrl = `https://api.weather.gov/points/${latitude},${longitude}`
  const points = await fetchWeatherJson<PointsResponse>(app, {
    sourceId: 'weather-gov',
    productId: 'points-radar',
    label: 'NWS point lookup',
    url: pointsUrl,
    cacheKey: cacheKey('weather-gov', 'points-radar', latitude, longitude),
    ttlMs: 15 * 60 * 1000,
  })

  return points.value.properties?.radarStation?.toUpperCase() ?? null
}

export async function getNexradRadar(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<RadarData>> {
  const location = await geocodeQuery(app, locationQuery)
  const radarStation = await loadRadarStation(
    app,
    location.latitude,
    location.longitude,
  )
  const [nexrad, guide] = await Promise.all([
    loadRadarPage(app, nexradInfoUrl(), 'nexrad-info', 'NEXRAD product page'),
    loadRadarPage(app, radarGuideUrl(), 'radar-guide', 'Radar guide'),
  ])
  const text = stripHtml(`${nexrad.value} ${guide.value}`)
  const loopUrl = radarStation
    ? `https://radar.weather.gov/ridge/standard/${radarStation}_loop.gif`
    : 'https://radar.weather.gov/ridge/standard/CONUS_loop.gif'
  const latestFrameUrl = radarStation
    ? `https://radar.weather.gov/ridge/standard/${radarStation}_0.gif`
    : 'https://radar.weather.gov/ridge/standard/CONUS_0.gif'

  return buildWeatherEnvelope({
    source: nexrad.source,
    location,
    units: 'reflectivity/velocity',
    confidence: 0.74,
    summary: summarizeText(text, 250) || `Radar context for ${location.name}.`,
    thumbnailUrl: loopUrl,
    imageAlt: radarStation
      ? `${radarStation} NEXRAD radar loop`
      : 'National NEXRAD radar loop',
    data: {
      products: [
        {
          productId: 'nexrad-public-data',
          title: 'NEXRAD public data',
          summary:
            'NEXRAD public-data pages describe the radar archive and scan products used for nowcasting.',
          url: nexradInfoUrl(),
          imageUrl: latestFrameUrl,
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
        radarStation
          ? `Nearest official radar loop is anchored to ${radarStation}.`
          : 'Falling back to the national composite loop because a nearby radar station was unavailable.',
      ],
      radarStation: radarStation ?? undefined,
      loopUrl,
      latestFrameUrl,
    },
  })
}
