import { parseEnv } from '@raincheck/config'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { geocodeQuery } from './geocode'
import { clearWeatherCache } from './runtime'

const env = parseEnv({
  NODE_ENV: 'test',
  RAINCHECK_APP_URL: 'http://localhost:3000',
  API_BASE_URL: 'http://localhost:3001',
  WEATHER_SERVICE_URL: 'http://localhost:8000',
  DB_URL: ':memory:',
  ARTIFACTS_DIR: './artifacts/generated',
  APP_ENCRYPTION_KEY: '12345678901234567890123456789012',
  OPENAI_API_KEY: 'test-openai',
  DEFAULT_CHAT_PROVIDER: 'openai',
  DEFAULT_CHAT_MODEL: 'gpt-4.1-mini',
  DEFAULT_RESEARCH_PROVIDER: 'openai',
  DEFAULT_RESEARCH_MODEL: 'gpt-4.1',
  DEFAULT_VISION_PROVIDER: 'openai',
  DEFAULT_VISION_MODEL: 'gpt-4.1-mini',
  NWS_USER_AGENT: 'RainCheck Test',
})

const app = {
  raincheckEnv: env,
} as FastifyInstance

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

describe('geocodeQuery', () => {
  afterEach(() => {
    clearWeatherCache()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('falls back to Open-Meteo for simple city names', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { addressMatches: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              name: 'Chicago',
              latitude: 41.85003,
              longitude: -87.65005,
              admin1: 'Illinois',
              country: 'United States',
              country_code: 'US',
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const location = await geocodeQuery(app, 'chicago')

    expect(location).toMatchObject({
      name: 'Chicago, Illinois, United States',
      latitude: 41.85003,
      longitude: -87.65005,
      region: 'Illinois',
      country: 'United States',
      resolvedBy: 'open-meteo-geocoding',
    })
  })

  it('uses state hints to disambiguate fallback place results', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { addressMatches: [] } }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              name: 'Springfield',
              latitude: 37.21533,
              longitude: -93.29824,
              admin1: 'Missouri',
              country: 'United States',
              country_code: 'US',
            },
            {
              name: 'Springfield',
              latitude: 39.80172,
              longitude: -89.64371,
              admin1: 'Illinois',
              country: 'United States',
              country_code: 'US',
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const location = await geocodeQuery(app, 'Springfield, IL')

    expect(location).toMatchObject({
      latitude: 39.80172,
      longitude: -89.64371,
      region: 'Illinois',
      resolvedBy: 'open-meteo-geocoding',
    })

    const simplifiedUrl = new URL(String(fetchMock.mock.calls[2]?.[0]))
    expect(simplifiedUrl.searchParams.get('name')).toBe('Springfield')
    expect(simplifiedUrl.searchParams.get('countryCode')).toBe('US')
  })

  it('returns a location_not_found error when providers return no matches', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { addressMatches: [] } }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(geocodeQuery(app, 'Atlantis')).rejects.toMatchObject({
      statusCode: 404,
      code: 'location_not_found',
    })
  })

  it('falls back from regional state shorthand to a state-level location', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { addressMatches: [] } }))
      .mockResolvedValueOnce(jsonResponse({ results: [] }))
      .mockResolvedValueOnce(jsonResponse({ result: { addressMatches: [] } }))
      .mockResolvedValueOnce(
        jsonResponse({
          results: [
            {
              name: 'Illinois',
              latitude: 40.0,
              longitude: -89.0,
              country: 'United States',
              country_code: 'US',
            },
          ],
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    const location = await geocodeQuery(app, 'central IL')

    expect(location).toMatchObject({
      query: 'central IL',
      name: 'Illinois, United States',
      latitude: 40.0,
      longitude: -89.0,
      country: 'United States',
      resolvedBy: 'open-meteo-geocoding',
    })
  })

  it('returns a location_resolution_failed error for upstream outages', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ result: { addressMatches: [] } }))
      .mockResolvedValueOnce(
        new Response('temporarily unavailable', {
          status: 503,
        }),
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(geocodeQuery(app, 'Chicago')).rejects.toMatchObject({
      statusCode: 502,
      code: 'location_resolution_failed',
    })
  })
})
