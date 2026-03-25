import {
  alertSummarySchema,
  citationSchema,
  currentConditionsSchema,
  forecastSummarySchema,
} from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { geocodeQuery } from './geocode'
import { cacheKey, fetchWeatherJson } from './runtime'

type PointsResponse = {
  properties: {
    forecast: string
    forecastHourly: string
    observationStations: string
    forecastOffice: string
  }
}

type ObservationStationsResponse = {
  features: Array<{
    properties: {
      stationIdentifier: string
    }
  }>
}

type LatestObservationResponse = {
  properties: {
    timestamp: string
    temperature: { value: number | null }
    relativeHumidity: { value: number | null }
    windSpeed: { value: number | null }
    windDirection: { value: number | null }
    textDescription: string
  }
}

type ForecastResponse = {
  properties: {
    generatedAt: string
    periods: Array<{
      name: string
      startTime: string
      endTime: string
      temperature: number
      temperatureUnit: 'F' | 'C'
      windSpeed: string
      windDirection: string
      shortForecast: string
      detailedForecast: string
    }>
  }
}

type AlertsResponse = {
  features: Array<{
    id: string
    properties: {
      headline: string
      severity: string
      certainty: string | null
      urgency: string | null
      effective: string | null
      expires: string | null
      areaDesc: string
      description: string
      instruction: string | null
    }
  }>
}

function makeCitation(
  sourceId: string,
  productId: string,
  label: string,
  url: string,
) {
  return citationSchema.parse({
    id: `${sourceId}:${productId}`,
    label,
    sourceId,
    productId,
    url,
  })
}

function metersPerSecondToMph(value: number | null) {
  return value == null ? null : Math.round(value * 2.23694)
}

function windDirectionToCardinal(value: number | null) {
  if (value == null) {
    return null
  }

  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return directions[Math.round(value / 45) % 8]
}

export async function getCurrentConditions(
  app: FastifyInstance,
  locationQuery: string,
) {
  const location = await geocodeQuery(app, locationQuery)
  const pointsUrl = `https://api.weather.gov/points/${location.latitude},${location.longitude}`
  const points = await fetchWeatherJson<PointsResponse>(app, {
    sourceId: 'weather-gov',
    productId: 'points',
    label: 'NWS point lookup',
    url: pointsUrl,
    cacheKey: cacheKey(
      'weather-gov',
      'points',
      location.latitude,
      location.longitude,
    ),
    ttlMs: 15 * 60 * 1000,
  })
  const stations = await fetchWeatherJson<ObservationStationsResponse>(app, {
    sourceId: 'weather-gov',
    productId: 'observation-stations',
    label: 'NWS observation stations',
    url: points.value.properties.observationStations,
    cacheKey: cacheKey(
      'weather-gov',
      'observation-stations',
      location.latitude,
      location.longitude,
    ),
    ttlMs: 15 * 60 * 1000,
  })
  const stationId = stations.value.features[0]?.properties.stationIdentifier
  const latestObservationUrl = `https://api.weather.gov/stations/${stationId}/observations/latest`
  const latestObservation = await fetchWeatherJson<LatestObservationResponse>(
    app,
    {
      sourceId: 'weather-gov',
      productId: 'latest-observation',
      label: 'NWS latest observation',
      url: latestObservationUrl,
      cacheKey: cacheKey('weather-gov', 'latest-observation', stationId),
      ttlMs: 10 * 60 * 1000,
    },
  )

  const temperatureC = latestObservation.value.properties.temperature.value
  const temperatureF =
    temperatureC == null ? null : Math.round((temperatureC * 9) / 5 + 32)

  return currentConditionsSchema.parse({
    location,
    temperature: {
      value: temperatureF ?? 0,
      unit: 'F',
    },
    wind: {
      speed: metersPerSecondToMph(
        latestObservation.value.properties.windSpeed.value,
      ),
      direction: windDirectionToCardinal(
        latestObservation.value.properties.windDirection.value,
      ),
    },
    humidityPercent: latestObservation.value.properties.relativeHumidity.value,
    textDescription: latestObservation.value.properties.textDescription,
    observedAt: latestObservation.value.properties.timestamp,
    source: makeCitation(
      'weather-gov',
      'latest-observation',
      'NWS latest observation',
      latestObservationUrl,
    ),
  })
}

export async function getForecast(
  app: FastifyInstance,
  locationQuery: string,
  horizon: 'short' | 'extended' = 'short',
) {
  const location = await geocodeQuery(app, locationQuery)
  const pointsUrl = `https://api.weather.gov/points/${location.latitude},${location.longitude}`
  const points = await fetchWeatherJson<PointsResponse>(app, {
    sourceId: 'weather-gov',
    productId: 'points',
    label: 'NWS point lookup',
    url: pointsUrl,
    cacheKey: cacheKey(
      'weather-gov',
      'points',
      location.latitude,
      location.longitude,
    ),
    ttlMs: 15 * 60 * 1000,
  })
  const forecastUrl =
    horizon === 'extended'
      ? points.value.properties.forecast
      : points.value.properties.forecastHourly
  const forecast = await fetchWeatherJson<ForecastResponse>(app, {
    sourceId: 'weather-gov',
    productId: horizon === 'extended' ? 'forecast' : 'forecast-hourly',
    label: horizon === 'extended' ? 'NWS forecast' : 'NWS hourly forecast',
    url: forecastUrl,
    cacheKey: cacheKey(
      'weather-gov',
      horizon === 'extended' ? 'forecast' : 'forecast-hourly',
      location.latitude,
      location.longitude,
    ),
    ttlMs: 15 * 60 * 1000,
  })

  return forecastSummarySchema.parse({
    location,
    generatedAt: forecast.value.properties.generatedAt,
    periods: forecast.value.properties.periods
      .slice(0, horizon === 'extended' ? 10 : 8)
      .map((period) => ({
        name: period.name,
        startTime: period.startTime,
        endTime: period.endTime,
        temperature: period.temperature,
        temperatureUnit: period.temperatureUnit,
        wind: `${period.windSpeed} ${period.windDirection}`.trim(),
        shortForecast: period.shortForecast,
        detailedForecast: period.detailedForecast,
      })),
    source: makeCitation(
      'weather-gov',
      horizon === 'extended' ? 'forecast' : 'forecast-hourly',
      horizon === 'extended' ? 'NWS forecast' : 'NWS hourly forecast',
      forecastUrl,
    ),
  })
}

export async function getAlerts(app: FastifyInstance, locationQuery: string) {
  const location = await geocodeQuery(app, locationQuery)
  const alertsUrl = `https://api.weather.gov/alerts/active?point=${location.latitude},${location.longitude}`
  const alerts = await fetchWeatherJson<AlertsResponse>(app, {
    sourceId: 'weather-gov',
    productId: 'alerts',
    label: 'NWS active alerts',
    url: alertsUrl,
    cacheKey: cacheKey(
      'weather-gov',
      'alerts',
      location.latitude,
      location.longitude,
    ),
    ttlMs: 5 * 60 * 1000,
  })

  return alerts.value.features.map((feature) =>
    alertSummarySchema.parse({
      id: feature.id,
      headline: feature.properties.headline,
      severity: feature.properties.severity,
      certainty: feature.properties.certainty,
      urgency: feature.properties.urgency,
      effective: feature.properties.effective,
      expires: feature.properties.expires,
      area: feature.properties.areaDesc,
      description: feature.properties.description,
      instruction: feature.properties.instruction,
      source: makeCitation('weather-gov', 'alerts', 'NWS alerts', alertsUrl),
    }),
  )
}
