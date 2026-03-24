import { parseEnv } from '@raincheck/config'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getSpcSevereProducts } from './spc'
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

function htmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/html',
    },
  })
}

describe('getSpcSevereProducts', () => {
  afterEach(() => {
    clearWeatherCache()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns a structured severe-weather envelope from the SPC/NWS severe page', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      htmlResponse(`
        <html>
          <head><title>Severe Weather Outlook</title></head>
          <body>
            <p>Valid 1200Z Thu Mar 24 2026 Through 1200Z Fri Mar 25 2026</p>
            <p>Day 1 Convective Outlook - Slight Risk</p>
            <p>Mesoscale Discussion and watches linked here.</p>
          </body>
        </html>
      `),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await getSpcSevereProducts(app, '35.22,-97.44')

    expect(result.sourceId).toBe('spc')
    expect(result.location).toMatchObject({
      latitude: 35.22,
      longitude: -97.44,
    })
    expect(result.data.products[0]?.productId).toBe(
      'spc-day1-convective-outlook',
    )
    expect(result.validRange).toMatchObject({
      start: '1200Z Thu Mar 24 2026',
      end: '1200Z Fri Mar 25 2026',
    })
  })
})
