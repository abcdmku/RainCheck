import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import { previewFromArtifact } from './previews'
import {
  buildWeatherEnvelope,
  cacheKey,
  fetchWeatherJson,
  type WeatherEnvelope,
} from './runtime'
import { generateArtifact } from './service-client'

type GaugeListItem = {
  lid: string
  name: string
  latitude: number
  longitude: number
  status?: {
    observed?: {
      primary?: number
      primaryUnit?: string
      secondary?: number
      secondaryUnit?: string
      floodCategory?: string
      validTime?: string
    }
    forecast?: {
      primary?: number
      primaryUnit?: string
      secondary?: number
      secondaryUnit?: string
      floodCategory?: string
      validTime?: string
    }
  }
}

type GaugeListResponse = {
  gauges: Array<GaugeListItem>
}

type GaugeStatus = NonNullable<GaugeListItem['status']>
type GaugeFlood = NonNullable<GaugeDetailResponse['flood']>

type GaugeDetailResponse = GaugeListItem & {
  description?: string
  flood?: {
    stageUnits?: string
    flowUnits?: string
    categories?: Record<
      string,
      {
        stage?: number
        flow?: number
      }
    >
  }
}

type StageFlowResponse = {
  observed?: {
    issuedTime?: string
    primaryUnits?: string
    secondaryUnits?: string
    data?: Array<{
      validTime: string
      primary: number
      secondary: number
    }>
  }
  forecast?: {
    issuedTime?: string
    primaryUnits?: string
    secondaryUnits?: string
    data?: Array<{
      validTime: string
      primary: number
      secondary: number
    }>
  }
}

type HydrologyData = {
  gauge: {
    lid: string
    name: string
    latitude: number
    longitude: number
  }
  observed: GaugeStatus['observed'] | null
  forecast: GaugeStatus['forecast'] | null
  thresholds: GaugeFlood['categories'] | null
  recentObservedPoints: Array<{
    validTime: string
    stage: number
    flow: number
  }>
  recentForecastPoints: Array<{
    validTime: string
    stage: number
    flow: number
  }>
}

function toChartPoints(
  series: Array<{ validTime: string; stage: number; flow: number }>,
  key: 'stage' | 'flow',
) {
  return series.slice(0, 8).map((point) => ({
    label: point.validTime.slice(11, 16),
    value: point[key],
  }))
}

function distanceScore(
  left: { latitude: number; longitude: number },
  right: { latitude: number; longitude: number },
) {
  const lat = left.latitude - right.latitude
  const lon = left.longitude - right.longitude
  return lat * lat + lon * lon
}

function bboxAround(latitude: number, longitude: number) {
  return {
    xmin: longitude - 0.35,
    ymin: latitude - 0.35,
    xmax: longitude + 0.35,
    ymax: latitude + 0.35,
  }
}

function firstPoints(
  series: Array<{ validTime: string; primary: number; secondary: number }> | undefined,
  limit = 8,
) {
  return (series ?? []).slice(0, limit).map((point) => ({
    validTime: point.validTime,
    stage: point.primary,
    flow: point.secondary,
  }))
}

export async function getHydrologyNwps(
  app: FastifyInstance,
  locationQuery: string,
): Promise<WeatherEnvelope<HydrologyData>> {
  const location = await geocodeQuery(app, locationQuery)
  const bbox = bboxAround(location.latitude, location.longitude)
  const gaugeListUrl = new URL('https://api.water.noaa.gov/nwps/v1/gauges')
  gaugeListUrl.searchParams.set('bbox.xmin', String(bbox.xmin))
  gaugeListUrl.searchParams.set('bbox.ymin', String(bbox.ymin))
  gaugeListUrl.searchParams.set('bbox.xmax', String(bbox.xmax))
  gaugeListUrl.searchParams.set('bbox.ymax', String(bbox.ymax))
  gaugeListUrl.searchParams.set('srid', 'EPSG_4326')

  const gaugeList = await fetchWeatherJson<GaugeListResponse>(app, {
    sourceId: 'nwps',
    productId: 'gauges',
    label: 'NWPS nearby gauges',
    url: gaugeListUrl.toString(),
    cacheKey: cacheKey('nwps', 'gauges', location.latitude, location.longitude),
    ttlMs: 10 * 60 * 1000,
  })

  const nearestGauge =
    gaugeList.value.gauges.sort(
      (left, right) =>
        distanceScore(left, location) - distanceScore(right, location),
    )[0] ?? null

  if (!nearestGauge) {
    const hydrographArtifact = await generateArtifact(app, {
      artifactType: 'hydrograph',
      locationQuery: location.name,
      prompt: `No nearby NWPS gauge was available for ${location.name}`,
    })
    const artifactHandle = {
      artifactId: hydrographArtifact.artifactId,
      type: String(hydrographArtifact.type),
      title: hydrographArtifact.title,
      href: hydrographArtifact.href,
      mimeType: hydrographArtifact.mimeType,
    }

    return buildWeatherEnvelope({
      source: gaugeList.source,
      location,
      units: {
        stage: 'ft',
        flow: 'cfs',
      },
      validAt: gaugeList.retrievedAt,
      confidence: 0.4,
      summary: `NWPS did not return a nearby gauge for ${location.name}.`,
      ...previewFromArtifact(
        artifactHandle,
        `${location.name} hydrology fallback preview`,
      ),
      data: {
        gauge: {
          lid: 'unknown',
          name: location.name,
          latitude: location.latitude,
          longitude: location.longitude,
        },
        observed: null,
        forecast: null,
        thresholds: null,
        recentObservedPoints: [],
        recentForecastPoints: [],
      },
      artifacts: [artifactHandle],
    })
  }

  const gaugeDetailUrl = `https://api.water.noaa.gov/nwps/v1/gauges/${nearestGauge.lid}`
  const stageFlowUrl = `${gaugeDetailUrl}/stageflow`
  const [gaugeDetail, stageFlow] = await Promise.all([
    fetchWeatherJson<GaugeDetailResponse>(app, {
      sourceId: 'nwps',
      productId: 'gauge-detail',
      label: 'NWPS gauge detail',
      url: gaugeDetailUrl,
      cacheKey: cacheKey('nwps', 'gauge-detail', nearestGauge.lid),
      ttlMs: 10 * 60 * 1000,
    }),
    fetchWeatherJson<StageFlowResponse>(app, {
      sourceId: 'nwps',
      productId: 'stageflow',
      label: 'NWPS stageflow',
      url: stageFlowUrl,
      cacheKey: cacheKey('nwps', 'stageflow', nearestGauge.lid),
      ttlMs: 10 * 60 * 1000,
    }),
  ])

  const observed = gaugeDetail.value.status?.observed ?? null
  const forecast = gaugeDetail.value.status?.forecast ?? null
  const stageUnits =
    gaugeDetail.value.flood?.stageUnits ??
    observed?.primaryUnit ??
    stageFlow.value.observed?.primaryUnits ??
    'ft'
  const flowUnits =
    gaugeDetail.value.flood?.flowUnits ??
    observed?.secondaryUnit ??
    stageFlow.value.observed?.secondaryUnits ??
    'cfs'

  const summaryParts = [
    `${nearestGauge.name} (${nearestGauge.lid})`,
    observed?.primary != null
      ? `observed ${observed.primary} ${stageUnits}`
      : null,
    observed?.floodCategory ? `category ${observed.floodCategory}` : null,
    forecast?.primary != null && forecast.primary > -900
      ? `forecast ${forecast.primary} ${stageUnits}`
      : null,
  ].filter(Boolean)
  const hydrographArtifact = await generateArtifact(app, {
    artifactType: 'hydrograph',
    locationQuery: nearestGauge.name,
    prompt: `Observed and forecast river stage for ${nearestGauge.name}`,
    chartSeries: [
      {
        label: 'Observed stage',
        color: '#4cc9f0',
        points: toChartPoints(firstPoints(stageFlow.value.observed?.data, 8), 'stage'),
      },
      {
        label: 'Forecast stage',
        color: '#79ddd0',
        points: toChartPoints(firstPoints(stageFlow.value.forecast?.data, 8), 'stage'),
      },
    ].filter((series) => series.points.length > 0),
  })
  const artifactHandle = {
    artifactId: hydrographArtifact.artifactId,
    type: String(hydrographArtifact.type),
    title: hydrographArtifact.title,
    href: hydrographArtifact.href,
    mimeType: hydrographArtifact.mimeType,
  }
  const preview = previewFromArtifact(
    artifactHandle,
    `${nearestGauge.name} hydrograph`,
    {
      severity: forecast?.floodCategory ?? observed?.floodCategory ?? undefined,
    },
  )

  return buildWeatherEnvelope({
    source: gaugeDetail.source,
    location,
    units: {
      stage: stageUnits,
      flow: flowUnits,
    },
    validAt: observed?.validTime ?? stageFlow.value.observed?.issuedTime ?? gaugeDetail.retrievedAt,
    confidence: 0.9,
    summary: `${summaryParts.join(', ')}.`.trim(),
    ...preview,
    data: {
      gauge: {
        lid: nearestGauge.lid,
        name: nearestGauge.name,
        latitude: nearestGauge.latitude,
        longitude: nearestGauge.longitude,
      },
      observed,
      forecast,
      thresholds: gaugeDetail.value.flood?.categories ?? null,
      recentObservedPoints: firstPoints(stageFlow.value.observed?.data),
      recentForecastPoints: firstPoints(stageFlow.value.forecast?.data),
    },
    artifacts: [artifactHandle],
    citations: [
      {
        id: 'nwps:gauge-detail',
        label: 'NWPS gauge detail',
        sourceId: 'nwps',
        productId: 'gauge-detail',
        kind: 'api',
        url: gaugeDetailUrl,
        issuedAt: gaugeDetail.retrievedAt,
      },
      {
        id: 'nwps:stageflow',
        label: 'NWPS stageflow',
        sourceId: 'nwps',
        productId: 'stageflow',
        kind: 'api',
        url: stageFlowUrl,
        issuedAt: stageFlow.retrievedAt,
      },
    ],
  })
}
