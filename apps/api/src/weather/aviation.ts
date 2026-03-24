import { aviationSummarySchema, citationSchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { fetchJson } from '../lib/http'

type AviationResponse = Array<{
  rawOb?: string
  rawTAF?: string
}>

function makeCitation(productId: string, url: string) {
  return citationSchema.parse({
    id: `aviationweather-gov:${productId}`,
    label: `Aviation Weather Center ${productId.toUpperCase()}`,
    sourceId: 'aviationweather-gov',
    productId,
    url,
  })
}

export async function getAviationSummary(
  app: FastifyInstance,
  stationId: string,
) {
  const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${encodeURIComponent(stationId)}&format=json`
  const tafUrl = `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(stationId)}&format=json`
  const [metar, taf] = await Promise.all([
    fetchJson<AviationResponse>(app.raincheckEnv, metarUrl).catch(() => []),
    fetchJson<AviationResponse>(app.raincheckEnv, tafUrl).catch(() => []),
  ])

  const metarRaw = metar[0]?.rawOb ?? null
  const tafRaw = taf[0]?.rawTAF ?? null
  const summary = [
    metarRaw ? `METAR ${metarRaw}` : null,
    tafRaw ? `TAF ${tafRaw}` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return aviationSummarySchema.parse({
    stationId,
    metar: metarRaw,
    taf: tafRaw,
    summary: summary || `No METAR/TAF currently available for ${stationId}.`,
    citations: [makeCitation('metar', metarUrl), makeCitation('taf', tafUrl)],
  })
}
