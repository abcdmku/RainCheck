import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import { previewFromArtifact } from './previews'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherText,
  type WeatherEnvelope,
} from './runtime'
import { generateArtifact } from './service-client'

type SatelliteProduct = {
  productId: string
  title: string
  summary: string
  url: string
  imageUrl?: string
}

type SatelliteData = {
  products: Array<SatelliteProduct>
  notes: Array<string>
  latestFrameUrl?: string
  loopFrames?: Array<{
    label: string
    timestamp?: string
    imageUrl: string
  }>
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

function extractSatelliteFrames(html: string) {
  const matches = [
    ...html.matchAll(
      /https:\/\/cdn\.star\.nesdis\.noaa\.gov\/GOES19\/ABI\/CONUS\/13\/([0-9]{11})_GOES19-ABI-CONUS-13-1250x750\.jpg/g,
    ),
  ]

  return matches.slice(-10).map((match) => ({
    label: `GOES-19 Band 13 ${match[1]}`,
    timestamp: goesTokenToIso(match[1]),
    imageUrl: match[0],
  }))
}

function goesTokenToIso(token: string) {
  if (!/^\d{11}$/.test(token)) {
    return undefined
  }

  const year = Number(token.slice(0, 4))
  const dayOfYear = Number(token.slice(4, 7))
  const hour = Number(token.slice(7, 9))
  const minute = Number(token.slice(9, 11))
  const utcDate = new Date(Date.UTC(year, 0, 1, hour, minute))
  utcDate.setUTCDate(utcDate.getUTCDate() + dayOfYear - 1)
  return utcDate.toISOString()
}

export async function getGoesSatellite(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<SatelliteData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [goes, guide] = await Promise.all([
    loadSatellitePage(app, goesInfoUrl(), 'goes-info', 'GOES product page'),
    loadSatellitePage(
      app,
      satelliteGuideUrl(),
      'satellite-guide',
      'Satellite guide',
    ),
  ])
  void guide
  const loopFrames = extractSatelliteFrames(goes.value)
  const latestFrameUrl =
    loopFrames.at(-1)?.imageUrl ??
    'https://cdn.star.nesdis.noaa.gov/GOES19/ABI/CONUS/13/latest.jpg'
  const loopArtifact = await generateArtifact(app, {
    artifactType: 'satellite-loop',
    locationQuery: location.name,
    prompt: `GOES-19 infrared loop for ${location.name}`,
    frames: loopFrames.map((frame) => ({
      label: frame.label,
      timestamp: frame.timestamp,
      description: 'Near-real-time GOES-19 clean longwave infrared frame.',
      imageUrl: frame.imageUrl,
    })),
  })
  const artifacts = [
    {
      artifactId: loopArtifact.artifactId,
      type: String(loopArtifact.type),
      title: loopArtifact.title,
      href: loopArtifact.href,
      mimeType: loopArtifact.mimeType,
    },
  ]
  const preview = previewFromArtifact(
    artifacts[0],
    'GOES-19 infrared satellite frame',
    {
      thumbnailUrl: latestFrameUrl,
    },
  )

  return buildWeatherEnvelope({
    source: goes.source,
    location,
    units: 'imagery',
    confidence: 0.74,
    summary: `GOES-19 infrared context is available for ${location.name} and supports cloud-top and convective evolution analysis.`,
    ...preview,
    artifacts,
    data: {
      products: [
        {
          productId: 'goes-abi-glm',
          title: 'GOES ABI / GLM',
          summary:
            'GOES ABI and GLM public-data pages describe the visible, infrared, water-vapor, and lightning products used in convection analysis.',
          url: goesInfoUrl(),
          imageUrl: latestFrameUrl,
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
        'The card thumbnail uses the latest GOES-19 infrared frame and opens a generated loop artifact.',
      ],
      latestFrameUrl,
      loopFrames,
    },
  })
}
