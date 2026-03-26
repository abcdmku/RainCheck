import { normalizedLocationSchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { AppError } from '../lib/errors'
import { cacheKey, fetchWeatherJson, normalizeWhitespace } from './runtime'

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

const usStateCodesByName = Object.fromEntries(
  Object.entries(usStatesByCode).map(([code, name]) => [
    name.toLowerCase(),
    code,
  ]),
) as Record<string, keyof typeof usStatesByCode>

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

const addressKeywordPattern =
  /\b(st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|cir|circle|trl|trail|pl|place|suite|ste|apt|unit)\b/i

const zipCodePattern = /\b\d{5}(?:-\d{4})?\b/

const houseNumberPattern = /^\s*\d+\b/

const geocodeTimeoutMs = 700

const embeddedLocationPattern =
  /\b(?:in|for|near|around|across|over|at|from)\s+(.+?)(?=\s+(?:where|where's|wheres|what|what's|whats|when|when's|whens|why|how|because|according|based|today|tonight|tomorrow|this|next|should|could|would|can|will|need|needs|show|see|avoid|head|expect|best|most|risk|risks)\b|[?!.;]|$)/i

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

function buildStateLevelHint(query: string): OpenMeteoSearchHint | null {
  const trimmed = query.trim().replace(/\.+$/, '')
  if (!trimmed) {
    return null
  }

  const upperCode = trimmed.toUpperCase()
  if (upperCode in usStatesByCode) {
    const name = usStatesByCode[upperCode as keyof typeof usStatesByCode]
    return {
      baseQuery: name,
      expectedAdmin1: name,
      expectedCountryCode: 'US',
      regionText: name,
    }
  }

  const stateCode = usStateCodesByName[trimmed.toLowerCase()]
  if (!stateCode) {
    return null
  }

  const name = usStatesByCode[stateCode]
  return {
    baseQuery: name,
    expectedAdmin1: name,
    expectedCountryCode: 'US',
    regionText: name,
  }
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
  const candidates = [
    buildStateLevelHint(query),
    buildUsStateHint(query),
    buildTrailingRegionHint(query),
  ]
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

function buildRegionalUsStateFallback(query: string) {
  const match = query
    .trim()
    .match(
      /^(north|northern|south|southern|east|eastern|west|western|central)\s+(.+)$/i,
    )

  if (!match?.[2]) {
    return null
  }

  const stateToken = match[2].trim().replace(/\.+$/, '')
  const upperStateToken = stateToken.toUpperCase()

  if (upperStateToken in usStatesByCode) {
    return usStatesByCode[upperStateToken as keyof typeof usStatesByCode]
  }

  const stateCode = usStateCodesByName[stateToken.toLowerCase()]
  if (stateCode) {
    return usStatesByCode[stateCode]
  }

  return null
}

function trimLocationFragment(value: string) {
  return value.replace(/^[,;:\s]+|[,;:\s]+$/g, '').trim()
}

function extractEmbeddedLocationQuery(query: string) {
  const normalized = normalizeWhitespace(query.replace(/^me:\s*/i, ' '))
  if (!normalized) {
    return normalized
  }

  const embeddedMatch = normalized.match(embeddedLocationPattern)
  const embeddedLocation = embeddedMatch?.[1]
    ? trimLocationFragment(embeddedMatch[1])
    : ''

  if (embeddedLocation && embeddedLocation.split(/\s+/).length <= 6) {
    return embeddedLocation
  }

  return normalized
}

function isLikelyAddressQuery(query: string) {
  return (
    houseNumberPattern.test(query) ||
    zipCodePattern.test(query) ||
    addressKeywordPattern.test(query)
  )
}

function buildGeocodeRequestInit(): RequestInit | undefined {
  if (typeof AbortSignal?.timeout !== 'function') {
    return undefined
  }

  return {
    signal: AbortSignal.timeout(geocodeTimeoutMs),
  }
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

  const normalizedBaseQuery = normalizeMatchValue(hint.baseQuery)
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

    const matchesBaseQuery = normalizedBaseQuery
      ? [
          normalizeMatchValue(result.name),
          normalizeMatchValue(result.admin1),
        ].includes(normalizedBaseQuery)
      : false
    const matchesAdmin1 = normalizedAdmin1
      ? normalizeMatchValue(result.admin1) === normalizedAdmin1
      : false

    if (
      normalizedBaseQuery &&
      normalizedAdmin1 &&
      matchesBaseQuery &&
      matchesAdmin1
    ) {
      return true
    }

    if (matchesAdmin1) {
      return true
    }

    if (
      normalizedAdmin1 &&
      normalizeMatchValue(result.name) === normalizedAdmin1
    ) {
      return true
    }

    if (matchesBaseQuery && !normalizedAdmin1) {
      return true
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

  return exactMatch ?? null
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
  const census = await fetchWeatherJson<CensusResponse>(
    app,
    {
      sourceId: 'us-census-geocoder',
      productId: 'address-normalization',
      label: 'U.S. Census Geocoder',
      url: censusUrl,
      cacheKey: cacheKey('geocode', 'census', query.toLowerCase()),
      ttlMs: 30 * 60 * 1000,
      retries: 0,
    },
    {
      requestInit: buildGeocodeRequestInit(),
    },
  )

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
    const response = await fetchWeatherJson<OpenMeteoResponse>(
      app,
      {
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
        retries: 0,
      },
      {
        requestInit: buildGeocodeRequestInit(),
      },
    )
    const match = pickOpenMeteoResult(
      response.value.results ?? [],
      attempt.hint,
    )

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
  const trimmed = extractEmbeddedLocationQuery(query)
  const latLonMatch = trimmed.match(latLonPattern)
  const regionalStateFallback = buildRegionalUsStateFallback(trimmed)
  const effectiveQuery = regionalStateFallback ?? trimmed
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

  const resolutionSteps = isLikelyAddressQuery(effectiveQuery)
    ? [
        {
          provider: 'us-census-geocoder',
          resolve: () => resolveWithCensus(app, effectiveQuery),
        },
        {
          provider: 'open-meteo-geocoding',
          resolve: () => resolveWithOpenMeteo(app, effectiveQuery),
        },
      ]
    : [
        {
          provider: 'open-meteo-geocoding',
          resolve: () => resolveWithOpenMeteo(app, effectiveQuery),
        },
        {
          provider: 'us-census-geocoder',
          resolve: () => resolveWithCensus(app, effectiveQuery),
        },
      ]

  for (const step of resolutionSteps) {
    try {
      const location = await step.resolve()
      if (!location) {
        continue
      }

      if (effectiveQuery !== trimmed) {
        return normalizedLocationSchema.parse({
          ...location,
          query: trimmed,
        })
      }

      return location
    } catch (error) {
      failures.push(toProviderFailure(step.provider, error))
    }
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
