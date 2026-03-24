import { normalizedLocationSchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { AppError } from '../lib/errors'
import { cacheKey, fetchWeatherJson } from './runtime'

const latLonPattern = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/

const usStatesByCode = {
  AL: 'Alabama',
  AK: 'Alaska',
  AZ: 'Arizona',
  AR: 'Arkansas',
  CA: 'California',
  CO: 'Colorado',
  CT: 'Connecticut',
  DE: 'Delaware',
  FL: 'Florida',
  GA: 'Georgia',
  HI: 'Hawaii',
  ID: 'Idaho',
  IL: 'Illinois',
  IN: 'Indiana',
  IA: 'Iowa',
  KS: 'Kansas',
  KY: 'Kentucky',
  LA: 'Louisiana',
  ME: 'Maine',
  MD: 'Maryland',
  MA: 'Massachusetts',
  MI: 'Michigan',
  MN: 'Minnesota',
  MS: 'Mississippi',
  MO: 'Missouri',
  MT: 'Montana',
  NE: 'Nebraska',
  NV: 'Nevada',
  NH: 'New Hampshire',
  NJ: 'New Jersey',
  NM: 'New Mexico',
  NY: 'New York',
  NC: 'North Carolina',
  ND: 'North Dakota',
  OH: 'Ohio',
  OK: 'Oklahoma',
  OR: 'Oregon',
  PA: 'Pennsylvania',
  RI: 'Rhode Island',
  SC: 'South Carolina',
  SD: 'South Dakota',
  TN: 'Tennessee',
  TX: 'Texas',
  UT: 'Utah',
  VT: 'Vermont',
  VA: 'Virginia',
  WA: 'Washington',
  WV: 'West Virginia',
  WI: 'Wisconsin',
  WY: 'Wyoming',
  DC: 'District of Columbia',
} as const

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

type OpenMeteoResponse = {
  results?: Array<{
    name: string
    latitude: number
    longitude: number
    admin1?: string
    country?: string
    country_code?: string
  }>
}

type OpenMeteoSearchHint = {
  baseQuery: string
  expectedAdmin1?: string
  expectedCountryCode?: string
  regionText: string
}

function normalizeMatchValue(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[.,]/g, '') ?? ''
}

function buildUsStateHint(query: string): OpenMeteoSearchHint | null {
  const trimmed = query.trim()

  for (const [code, name] of Object.entries(usStatesByCode)) {
    for (const suffix of [`, ${code}`, ` ${code}`, `, ${name}`, ` ${name}`]) {
      if (!trimmed.toLowerCase().endsWith(suffix.toLowerCase())) {
        continue
      }

      const baseQuery = trimmed
        .slice(0, -suffix.length)
        .replace(/,$/, '')
        .trim()
      if (!baseQuery) {
        return null
      }

      return {
        baseQuery,
        expectedAdmin1: name,
        expectedCountryCode: 'US',
        regionText: name,
      }
    }
  }

  return null
}

function buildTrailingRegionHint(query: string): OpenMeteoSearchHint | null {
  const trimmed = query.trim()
  const commaParts = trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)

  if (commaParts.length >= 2) {
    const regionText = commaParts.at(-1) ?? ''
    const baseQuery = commaParts.slice(0, -1).join(', ')
    if (!baseQuery || !regionText) {
      return null
    }

    return {
      baseQuery,
      expectedCountryCode:
        regionText.length === 2 ? regionText.toUpperCase() : undefined,
      regionText,
    }
  }

  const trailingCodeMatch = trimmed.match(/^(.*\S)\s+([A-Za-z]{2})$/)
  if (!trailingCodeMatch) {
    return null
  }

  return {
    baseQuery: trailingCodeMatch[1].trim(),
    expectedCountryCode: trailingCodeMatch[2].toUpperCase(),
    regionText: trailingCodeMatch[2].toUpperCase(),
  }
}

function buildOpenMeteoHints(query: string) {
  const candidates = [buildUsStateHint(query), buildTrailingRegionHint(query)]
  const seen = new Set<string>()

  return candidates.filter((candidate): candidate is OpenMeteoSearchHint => {
    if (!candidate) {
      return false
    }

    const key = [
      candidate.baseQuery,
      candidate.expectedAdmin1 ?? '',
      candidate.expectedCountryCode ?? '',
      candidate.regionText,
    ].join('|')

    if (seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function pickOpenMeteoResult(
  results: NonNullable<OpenMeteoResponse['results']>,
  hint?: OpenMeteoSearchHint,
) {
  if (results.length === 0) {
    return null
  }

  if (!hint) {
    return results[0]
  }

  const normalizedRegion = normalizeMatchValue(hint.regionText)
  const normalizedAdmin1 = normalizeMatchValue(hint.expectedAdmin1)
  const expectedCountryCode = hint.expectedCountryCode?.toUpperCase()

  const exactMatch = results.find((result) => {
    if (
      expectedCountryCode &&
      result.country_code?.toUpperCase() !== expectedCountryCode
    ) {
      return false
    }

    if (normalizedAdmin1) {
      return normalizeMatchValue(result.admin1) === normalizedAdmin1
    }

    if (!normalizedRegion) {
      return true
    }

    return [
      normalizeMatchValue(result.admin1),
      normalizeMatchValue(result.country),
      normalizeMatchValue(result.country_code),
    ].includes(normalizedRegion)
  })

  return exactMatch ?? results[0]
}

function formatOpenMeteoLocationName(location: {
  name: string
  admin1?: string
  country?: string
}) {
  return [
    ...new Set(
      [location.name, location.admin1, location.country].filter(Boolean),
    ),
  ].join(', ')
}

async function resolveWithCensus(app: FastifyInstance, query: string) {
  const censusUrl = `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress?benchmark=Public_AR_Current&format=json&address=${encodeURIComponent(query)}`
  const census = await fetchWeatherJson<CensusResponse>(app, {
    sourceId: 'us-census-geocoder',
    productId: 'address-normalization',
    label: 'U.S. Census Geocoder',
    url: censusUrl,
    cacheKey: cacheKey('geocode', 'census', query.toLowerCase()),
    ttlMs: 30 * 60 * 1000,
  })

  const censusMatch = census.value?.result.addressMatches[0]
  if (!censusMatch) {
    return null
  }

  return normalizedLocationSchema.parse({
    query,
    name: censusMatch.matchedAddress,
    latitude: censusMatch.coordinates.y,
    longitude: censusMatch.coordinates.x,
    resolvedBy: 'us-census-geocoder',
  })
}

async function resolveWithOpenMeteo(app: FastifyInstance, query: string) {
  const hints = buildOpenMeteoHints(query)
  const attempts = [
    { name: query, hint: hints[0] },
    ...hints.map((hint) => ({
      name: hint.baseQuery,
      hint,
    })),
  ]
  const seen = new Set<string>()

  for (const attempt of attempts) {
    const key = [
      attempt.name,
      attempt.hint?.expectedAdmin1 ?? '',
      attempt.hint?.expectedCountryCode ?? '',
      attempt.hint?.regionText ?? '',
    ].join('|')

    if (seen.has(key)) {
      continue
    }

    seen.add(key)

    const params = new URLSearchParams({
      name: attempt.name,
      count: '10',
      language: 'en',
      format: 'json',
    })
    if (attempt.hint?.expectedCountryCode) {
      params.set('countryCode', attempt.hint.expectedCountryCode)
    }

    const url = `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`
    const response = await fetchWeatherJson<OpenMeteoResponse>(app, {
      sourceId: 'open-meteo-geocoding',
      productId: 'global-place-search',
      label: 'Open-Meteo Geocoding API',
      url,
      cacheKey: cacheKey(
        'geocode',
        'open-meteo',
        attempt.name.toLowerCase(),
        attempt.hint?.expectedCountryCode ?? '',
        attempt.hint?.expectedAdmin1 ?? '',
      ),
      ttlMs: 30 * 60 * 1000,
    })
    const match = pickOpenMeteoResult(response.value.results ?? [], attempt.hint)

    if (!match) {
      continue
    }

    return normalizedLocationSchema.parse({
      query,
      name: formatOpenMeteoLocationName(match),
      latitude: match.latitude,
      longitude: match.longitude,
      region: match.admin1,
      country: match.country,
      resolvedBy: 'open-meteo-geocoding',
    })
  }

  return null
}

function toProviderFailure(provider: string, error: unknown) {
  if (error instanceof AppError) {
    return {
      provider,
      code: error.code,
      status: error.statusCode,
      message: error.message,
    }
  }

  return {
    provider,
    code: 'unknown_error',
    message: error instanceof Error ? error.message : 'Unknown error',
  }
}

export async function geocodeQuery(app: FastifyInstance, query: string) {
  const trimmed = query.trim()
  const latLonMatch = trimmed.match(latLonPattern)
  const failures: Array<ReturnType<typeof toProviderFailure>> = []

  if (!trimmed) {
    throw new AppError(
      400,
      'invalid_location_query',
      'Location query cannot be empty.',
      { query },
    )
  }

  if (latLonMatch) {
    return normalizedLocationSchema.parse({
      query: trimmed,
      name: trimmed,
      latitude: Number(latLonMatch[1]),
      longitude: Number(latLonMatch[2]),
      resolvedBy: 'literal-latlon',
    })
  }

  try {
    const census = await resolveWithCensus(app, trimmed)
    if (census) {
      return census
    }
  } catch (error) {
    failures.push(toProviderFailure('us-census-geocoder', error))
  }

  try {
    const openMeteo = await resolveWithOpenMeteo(app, trimmed)
    if (openMeteo) {
      return openMeteo
    }
  } catch (error) {
    failures.push(toProviderFailure('open-meteo-geocoding', error))
  }

  if (failures.length > 0) {
    throw new AppError(
      502,
      'location_resolution_failed',
      `Could not resolve location "${trimmed}" because upstream geocoders were unavailable.`,
      {
        query: trimmed,
        providers: failures,
      },
    )
  }

  throw new AppError(
    404,
    'location_not_found',
    `Could not resolve location "${trimmed}".`,
    { query: trimmed },
  )
}
