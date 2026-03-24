import { aviationSummarySchema, citationSchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { cacheKey, fetchWeatherJson } from './runtime'

type AviationResponse = Array<{
  rawOb?: string
  rawTAF?: string
}>

type HazardResponse = Array<Record<string, unknown>>

function makeCitation(productId: string, url: string) {
  return citationSchema.parse({
    id: `aviationweather-gov:${productId}`,
    label: `Aviation Weather Center ${productId.toUpperCase()}`,
    sourceId: 'aviationweather-gov',
    productId,
    url,
  })
}

function summarizeHazards(label: string, records: HazardResponse, key: string) {
  return records.slice(0, 3).map((record) => {
    const hazard = String(record[key] ?? record.hazard ?? record.icaoId ?? 'hazard')
    return `${label}: ${hazard}`
  })
}

export async function getAviationSummary(
  app: FastifyInstance,
  stationId: string,
) {
  const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(stationId)}&format=json`
  const tafUrl = `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(stationId)}&format=json`
  const sigmetUrl = 'https://aviationweather.gov/api/data/airsigmet?format=json'
  const gairmetUrl = 'https://aviationweather.gov/api/data/gairmet?format=json'
  const cwaUrl = 'https://aviationweather.gov/api/data/cwa?format=json'
  const pirepUrl = `https://aviationweather.gov/api/data/pirep?id=${encodeURIComponent(stationId)}&distance=75&format=json`

  const [metar, taf, sigmets, gAirmets, cwas, pireps] = await Promise.all([
    fetchWeatherJson<AviationResponse>(app, {
      sourceId: 'aviationweather-gov',
      productId: 'metar',
      label: 'Aviation METAR',
      url: metarUrl,
      cacheKey: cacheKey('aviation', 'metar', stationId),
      ttlMs: 5 * 60 * 1000,
    }).catch(() => ({ value: [] } as { value: AviationResponse })),
    fetchWeatherJson<AviationResponse>(app, {
      sourceId: 'aviationweather-gov',
      productId: 'taf',
      label: 'Aviation TAF',
      url: tafUrl,
      cacheKey: cacheKey('aviation', 'taf', stationId),
      ttlMs: 5 * 60 * 1000,
    }).catch(() => ({ value: [] } as { value: AviationResponse })),
    fetchWeatherJson<HazardResponse>(app, {
      sourceId: 'aviationweather-gov',
      productId: 'sigmet',
      label: 'Aviation SIGMET',
      url: sigmetUrl,
      cacheKey: cacheKey('aviation', 'sigmet'),
      ttlMs: 5 * 60 * 1000,
    }).catch(() => ({ value: [] } as { value: HazardResponse })),
    fetchWeatherJson<HazardResponse>(app, {
      sourceId: 'aviationweather-gov',
      productId: 'gairmet',
      label: 'Aviation G-AIRMET',
      url: gairmetUrl,
      cacheKey: cacheKey('aviation', 'gairmet'),
      ttlMs: 5 * 60 * 1000,
    }).catch(() => ({ value: [] } as { value: HazardResponse })),
    fetchWeatherJson<HazardResponse>(app, {
      sourceId: 'aviationweather-gov',
      productId: 'cwa',
      label: 'Center Weather Advisory',
      url: cwaUrl,
      cacheKey: cacheKey('aviation', 'cwa'),
      ttlMs: 5 * 60 * 1000,
    }).catch(() => ({ value: [] } as { value: HazardResponse })),
    fetchWeatherJson<HazardResponse>(app, {
      sourceId: 'aviationweather-gov',
      productId: 'pirep',
      label: 'Pilot reports',
      url: pirepUrl,
      cacheKey: cacheKey('aviation', 'pirep', stationId),
      ttlMs: 5 * 60 * 1000,
    }).catch(() => ({ value: [] } as { value: HazardResponse })),
  ])

  const metarRaw = metar.value[0]?.rawOb ?? null
  const tafRaw = taf.value[0]?.rawTAF ?? null
  const hazardSummary = [
    ...summarizeHazards('SIGMET', sigmets.value, 'hazard'),
    ...summarizeHazards('G-AIRMET', gAirmets.value, 'hazard'),
    ...summarizeHazards('CWA', cwas.value, 'hazard'),
    ...summarizeHazards('PIREP', pireps.value, 'rawOb'),
  ]
  const summary = [
    metarRaw ? `METAR ${metarRaw}` : null,
    tafRaw ? `TAF ${tafRaw}` : null,
    ...hazardSummary,
  ]
    .filter(Boolean)
    .join(' ')

  return aviationSummarySchema.parse({
    stationId,
    metar: metarRaw,
    taf: tafRaw,
    hazards: {
      sigmets: summarizeHazards('SIGMET', sigmets.value, 'hazard'),
      gAirmets: summarizeHazards('G-AIRMET', gAirmets.value, 'hazard'),
      cwas: summarizeHazards('CWA', cwas.value, 'hazard'),
      pireps: summarizeHazards('PIREP', pireps.value, 'rawOb'),
    },
    summary: summary || `No METAR, TAF, or nearby aviation hazards were available for ${stationId}.`,
    citations: [
      makeCitation('metar', metarUrl),
      makeCitation('taf', tafUrl),
      makeCitation('sigmet', sigmetUrl),
      makeCitation('gairmet', gairmetUrl),
      makeCitation('cwa', cwaUrl),
      makeCitation('pirep', pirepUrl),
    ],
  })
}
