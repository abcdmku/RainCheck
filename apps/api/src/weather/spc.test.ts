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

  it('returns official SPC outlook pages with parsed risk summaries and live links', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)

      if (url.includes('/products/outlook/day1otlk.html')) {
        return htmlResponse(`
          <html>
            <script>show_tab('otlk_2000')</script>
            <body>
              <pre>
Valid 242000Z - 251200Z

...NO SEVERE THUNDERSTORM AREAS FORECAST...

...SUMMARY...
Severe storms are not expected today.
              </pre>
            </body>
          </html>
        `)
      }

      if (url.includes('/products/outlook/day2otlk.html')) {
        return htmlResponse(`
          <html>
            <script>show_tab('otlk_0600')</script>
            <body>
              <pre>
Valid 251200Z - 261200Z

...NO SEVERE THUNDERSTORM AREAS FORECAST...

...SUMMARY...
Severe storms are not expected through Wednesday night.
              </pre>
            </body>
          </html>
        `)
      }

      if (url.includes('/products/outlook/day3otlk.html')) {
        return htmlResponse(`
          <html>
            <script>show_tab('otlk_1930')</script>
            <body>
              <pre>
Valid 261200Z - 271200Z

...THERE IS A SLIGHT RISK OF SEVERE THUNDERSTORMS OVER MUCH OF
ILLINOIS...INDIANA...AND WESTERN OHIO...

...SUMMARY...
Scattered strong to severe thunderstorms are expected late Thursday
afternoon and evening across parts of the Midwest and Ohio River
Valley. Very large hail appears likely. A few tornadoes will be
possible.
              </pre>
            </body>
          </html>
        `)
      }

      if (url.includes('/products/exper/day4-8/')) {
        return htmlResponse(`
          <html>
            <script>show_tab('48')</script>
            <body>
              <pre>
Valid 271200Z - 011200Z

...DISCUSSION...
Widespread severe thunderstorm potential appears limited through the
remainder of March.
              </pre>
            </body>
          </html>
        `)
      }

      if (url.includes('/products/watch/')) {
        return htmlResponse(`
          <html>
            <body>
              <strong>No watches are currently valid</strong>
              <a href="/products/watch/ww0074.html">Most recently issued watch #0074.</a>
            </body>
          </html>
        `)
      }

      if (url.includes('/products/md/')) {
        return htmlResponse(`
          <html>
            <body>
              <center>No Mesoscale Discussions are currently in effect.</center>
              <center><a href="/products/md/md0290.html">Most recently issued Mesoscale Discussion #0290.</a></center>
            </body>
          </html>
        `)
      }

      if (url.includes('geocoding.geo.census.gov')) {
        return new Response(
          JSON.stringify({ result: { addressMatches: [] } }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      if (url.includes('geocoding-api.open-meteo.com')) {
        return new Response(
          JSON.stringify({
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
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        )
      }

      throw new Error(`Unexpected URL in SPC test: ${url}`)
    })

    vi.stubGlobal('fetch', fetchMock)

    const result = await getSpcSevereProducts(app, 'Chicago')
    const day3Product = result.data.products.find(
      (product) => product.productId === 'spc-day3-convective-outlook',
    )

    expect(result.sourceId).toBe('spc')
    expect(result.location).toMatchObject({
      name: 'Chicago, Illinois, United States',
      region: 'Illinois',
    })
    expect(result.summary).toContain('SPC Day 3 Convective Outlook')
    expect(result.thumbnailUrl).toBe(
      'https://www.spc.noaa.gov/products/outlook/day3otlk_1930.png',
    )
    expect(result.imageAlt).toBe('SPC Day 3 Convective Outlook outlook graphic')
    expect(day3Product?.url).toBe(
      'https://www.spc.noaa.gov/products/outlook/day3otlk.html',
    )
    expect(day3Product?.imageUrl).toBe(
      'https://www.spc.noaa.gov/products/outlook/day3otlk_1930.png',
    )
    expect(day3Product?.summary).toContain('Very large hail appears likely')
    expect(day3Product?.summary).toContain('ILLINOIS')
    expect(result.data.watchContext).toContain('No watches are currently valid')
    expect(result.data.mesoscaleContext).toContain(
      'No mesoscale discussions are currently in effect',
    )
    expect(result.data.mesoanalysisUrl).toBe(
      'https://www.spc.noaa.gov/exper/mesoanalysis/',
    )
  })

  it('supports national severe outlook requests without geocoding a city', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)

      if (url.includes('/products/watch/')) {
        return htmlResponse('<strong>No watches are currently valid</strong>')
      }

      if (url.includes('/products/md/')) {
        return htmlResponse(
          '<center>No Mesoscale Discussions are currently in effect.</center>',
        )
      }

      return htmlResponse(`
        <html>
          <body>
            <pre>
Valid 261200Z - 271200Z

...THERE IS A SLIGHT RISK OF SEVERE THUNDERSTORMS...

...SUMMARY...
Scattered severe thunderstorms are expected across parts of the Midwest.
            </pre>
          </body>
        </html>
      `)
    })

    vi.stubGlobal('fetch', fetchMock)

    const result = await getSpcSevereProducts(app, '')

    expect(result.location).toMatchObject({
      query: 'United States',
      name: 'Contiguous United States',
      resolvedBy: 'spc-national-default',
    })
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining('geocoding'),
      expect.anything(),
    )
  })
})
