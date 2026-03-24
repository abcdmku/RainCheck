import { normalizedLocationSchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { fetchJson } from '../lib/http'

const latLonPattern = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/

type CensusResponse = {
  result: {
    addressMatches: Array<{
      matchedAddress: string
      coordinates: {
        x: number
        y: number
      }
    }>
  }
}

type NominatimResponse = Array<{
  display_name: string
  lat: string
  lon: string
}>

export async function geocodeQuery(app: FastifyInstance, query: string) {
  const trimmed = query.trim()
  const latLonMatch = trimmed.match(latLonPattern)

  if (latLonMatch) {
    return normalizedLocationSchema.parse({
      query: trimmed,
      name: trimmed,
      latitude: Number(latLonMatch[1]),
      longitude: Number(latLonMatch[2]),
      resolvedBy: 'literal-latlon',
    })
  }

  const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(trimmed)}`
  const census = await fetchJson<CensusResponse>(
    app.raincheckEnv,
    censusUrl,
  ).catch(() => null)

  const censusMatch = census?.result.addressMatches[0]
  if (censusMatch) {
    return normalizedLocationSchema.parse({
      query: trimmed,
      name: censusMatch.matchedAddress,
      latitude: censusMatch.coordinates.y,
      longitude: censusMatch.coordinates.x,
      resolvedBy: 'us-census-geocoder',
    })
  }

  const nominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(trimmed)}`
  const nominatim = await fetchJson<NominatimResponse>(
    app.raincheckEnv,
    nominatimUrl,
    {
      headers: {
        Accept: 'application/json',
      },
    },
  )

  const location = nominatim[0]
  return normalizedLocationSchema.parse({
    query: trimmed,
    name: location?.display_name ?? trimmed,
    latitude: Number(location?.lat ?? 0),
    longitude: Number(location?.lon ?? 0),
    resolvedBy: 'nominatim',
  })
}
