import { parseEnv } from '@raincheck/config'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  cacheKey,
  clearWeatherCache,
  fetchWeatherJson,
  fetchWeatherJsonCandidates,
} from './runtime'

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

describe('weather runtime helper', () => {
  afterEach(() => {
    clearWeatherCache()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('caches repeated fetches for the same source key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', fetchMock)

    const target = {
      sourceId: 'weather-gov',
      productId: 'points',
      label: 'NWS point lookup',
      url: 'https://api.weather.gov/points/35,-97',
      cacheKey: cacheKey('weather-gov', 'points', '35,-97'),
    }

    const first = await fetchWeatherJson<{ ok: boolean }>(app, target)
    const second = await fetchWeatherJson<{ ok: boolean }>(app, target)

    expect(first.value.ok).toBe(true)
    expect(second.cached).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('falls back to the next candidate source', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream failure', { status: 503 }))
      .mockResolvedValueOnce(jsonResponse({ result: { answer: 42 } }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchWeatherJsonCandidates<{ result: { answer: number } }>(
      app,
      [
        {
          sourceId: 'first-source',
          productId: 'alpha',
          label: 'First source',
          url: 'https://example.com/first',
        },
        {
          sourceId: 'second-source',
          productId: 'beta',
          label: 'Second source',
          url: 'https://example.com/second',
        },
      ],
    )

    expect(result.value.result.answer).toBe(42)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
