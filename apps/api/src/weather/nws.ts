import {
  alertSummarySchema,
  citationSchema,
  currentConditionsSchema,
  forecastSummarySchema,
  severeSummarySchema,
} from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { fetchJson, fetchText } from '../lib/http'
import { geocodeQuery } from './geocode'

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
  const points = await fetchJson<PointsResponse>(app.raincheckEnv, pointsUrl)
  const stations = await fetchJson<ObservationStationsResponse>(
    app.raincheckEnv,
    points.properties.observationStations,
  )
  const stationId = stations.features[0]?.properties.stationIdentifier
  const latestObservationUrl = `https://api.weather.gov/stations/${stationId}/observations/latest`
  const latestObservation = await fetchJson<LatestObservationResponse>(
    app.raincheckEnv,
    latestObservationUrl,
  )

  const temperatureC = latestObservation.properties.temperature.value
  const temperatureF =
    temperatureC == null ? null : Math.round((temperatureC * 9) / 5 + 32)

  return currentConditionsSchema.parse({
    location,
    temperature: {
      value: temperatureF ?? 0,
      unit: 'F',
    },
    wind: {
      speed: metersPerSecondToMph(latestObservation.properties.windSpeed.value),
      direction: windDirectionToCardinal(
        latestObservation.properties.windDirection.value,
      ),
    },
    humidityPercent: latestObservation.properties.relativeHumidity.value,
    textDescription: latestObservation.properties.textDescription,
    observedAt: latestObservation.properties.timestamp,
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
  const points = await fetchJson<PointsResponse>(app.raincheckEnv, pointsUrl)
  const forecastUrl =
    horizon === 'extended'
      ? points.properties.forecast
      : points.properties.forecastHourly
  const forecast = await fetchJson<ForecastResponse>(
    app.raincheckEnv,
    forecastUrl,
  )

  return forecastSummarySchema.parse({
    location,
    generatedAt: forecast.properties.generatedAt,
    periods: forecast.properties.periods
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
  const alerts = await fetchJson<AlertsResponse>(app.raincheckEnv, alertsUrl)

  return alerts.features.map((feature) =>
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

export async function getSevereSummary(
  app: FastifyInstance,
  locationQuery: string,
) {
  const alerts = await getAlerts(app, locationQuery)
  const outlookUrl = 'https://www.spc.noaa.gov/products/outlook/'
  const outlookText = await fetchText(app.raincheckEnv, outlookUrl).catch(
    () => '',
  )

  return severeSummarySchema.parse({
    area: locationQuery,
    summary:
      alerts.length > 0
        ? `Active alerts are present. ${alerts[0]?.headline ?? ''}`.trim()
        : 'No active local alerts were found. SPC outlook context is available for broader severe-weather discussion.',
    outlookCategory: outlookText.includes('Moderate')
      ? 'Moderate'
      : outlookText.includes('Slight')
        ? 'Slight'
        : null,
    watchContext:
      alerts.find((alert) => /watch/i.test(alert.headline))?.headline ?? null,
    citations: [
      makeCitation('spc', 'outlook', 'SPC outlooks', outlookUrl),
      ...alerts.map((alert) => alert.source),
    ],
  })
}
