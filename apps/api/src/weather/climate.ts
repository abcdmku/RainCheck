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

type ClimateProduct = {
  productId: string
  title: string
  summary: string
  url: string
}

type ClimateData = {
  products: Array<ClimateProduct>
  notes: Array<string>
}

function cdoUrl() {
  return 'https://www.ncei.noaa.gov/cdo-web/'
}

function accessUrl() {
  return 'https://www.ncei.noaa.gov/access/'
}

function stormEventsUrl() {
  return 'https://www.ncei.noaa.gov/stormevents/'
}

async function loadClimatePage(
  app: FastifyInstance,
  sourceId: string,
  url: string,
  key: string,
  label: string,
) {
  return fetchWeatherText(app, {
    sourceId,
    productId: key,
    label,
    url,
    cacheKey: cacheKey(sourceId, key),
    ttlMs: 10 * 60 * 1000,
  })
}

export async function getHistoricalClimate(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<ClimateData>> {
  const location = await geocodeQuery(app, locationQuery)
  const [accessPage, cdoPage, datasetProbe, tokenNote] = await Promise.all([
    loadClimatePage(
      app,
      'ncei-cdo',
      accessUrl(),
      'ncei-access',
      'NCEI access portal',
    ),
    loadClimatePage(app, 'ncei-cdo', cdoUrl(), 'ncei-cdo', 'NCEI CDO portal'),
    app.raincheckEnv.NCEI_CDO_TOKEN
      ? fetchWeatherJson<{ results?: Array<{ id: string; name: string }> }>(
          app,
          {
            sourceId: 'ncei-cdo',
            productId: 'cdo-datasets',
            label: 'NCEI CDO datasets',
            url: 'https://www.ncei.noaa.gov/cdo-web/api/v2/datasets?limit=1',
            cacheKey: cacheKey('ncei-cdo', 'cdo-datasets'),
            ttlMs: 10 * 60 * 1000,
          },
          {
            requestInit: {
              headers: {
                token: app.raincheckEnv.NCEI_CDO_TOKEN,
              },
            },
          },
        )
      : Promise.resolve(null),
    Promise.resolve(app.raincheckEnv.NCEI_CDO_TOKEN ? 'token configured' : 'token missing'),
  ])
  const text = stripHtml(`${accessPage.value} ${cdoPage.value}`)

  return buildWeatherEnvelope({
    source: accessPage.source,
    location,
    units: 'climate',
    confidence: 0.6,
    summary:
      summarizeText(text, 240) ||
      `Historical climate context for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'ncei-access',
          title: 'NCEI Access',
          summary:
            'The NCEI Access portal provides entry points for historical weather and climate research.',
          url: accessUrl(),
        },
        {
          productId: 'ncei-cdo',
          title: 'NCEI CDO',
          summary:
            'The NCEI Climate Data Online portal is the primary API-backed historical-climate source.',
          url: cdoUrl(),
        },
        ...(datasetProbe
          ? [
              {
                productId: 'ncei-cdo-dataset-probe',
                title: 'NCEI CDO dataset probe',
                summary:
                  'A token-backed CDO probe confirms that the API can be reached and enumerates datasets.',
                url: 'https://www.ncei.noaa.gov/cdo-web/api/v2/datasets?limit=1',
              },
            ]
          : []),
      ],
      notes: [
        tokenNote === 'token configured'
          ? 'A CDO token is configured and can be used by future API-backed station queries.'
          : 'A free NCEI CDO token is not configured, so this connector currently surfaces portal-level guidance only.',
      ],
    },
  })
}

export async function getStormHistory(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<ClimateData>> {
  const location = await geocodeQuery(app, locationQuery)
  const page = await loadClimatePage(
    app,
    'ncei-storm-events',
    stormEventsUrl(),
    'ncei-storm-events',
    'NCEI Storm Events',
  )
  const text = stripHtml(page.value)

  return buildWeatherEnvelope({
    source: page.source,
    location,
    units: 'event-history',
    confidence: 0.63,
    summary:
      summarizeText(text, 240) ||
      `Historical storm-event context for ${location.name}.`,
    data: {
      products: [
        {
          productId: 'ncei-storm-events',
          title: 'NCEI Storm Events Database',
          summary:
            'The NCEI Storm Events Database is NOAA\'s official record for historical severe-weather events.',
          url: stormEventsUrl(),
        },
        {
          productId: 'ncei-access-search',
          title: 'NCEI Access Search',
          summary:
            'The access portal supports adjacent historical and climatological research queries.',
          url: accessUrl(),
        },
      ],
      notes: [
        'Storm history should lean on the official Storm Events Database for event counts and narratives.',
      ],
    },
  })
}
