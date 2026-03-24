import { parseEnv } from '@raincheck/config'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { generateArtifact } from './service-client'
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

describe('generateArtifact', () => {
  afterEach(() => {
    clearWeatherCache()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends live forecast-derived chart points to the weather service meteogram endpoint', async () => {
    let artifactRequestBody: any = null
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: any) => {
      const url = String(input)

      if (url.startsWith('https://geocoding.geo.census.gov/')) {
        return jsonResponse({
          result: {
            addressMatches: [
              {
                matchedAddress: 'Austin, TX',
                coordinates: {
                  x: -97.7431,
                  y: 30.2672,
                },
              },
            ],
          },
        })
      }

      if (url === 'https://api.weather.gov/points/30.2672,-97.7431') {
        return jsonResponse({
          properties: {
            forecast: 'https://api.weather.gov/gridpoints/EWX/1,1/forecast',
            forecastHourly:
              'https://api.weather.gov/gridpoints/EWX/1,1/forecast/hourly',
            observationStations:
              'https://api.weather.gov/gridpoints/EWX/1,1/stations',
            forecastOffice: 'EWX',
          },
        })
      }

      if (url === 'https://api.weather.gov/gridpoints/EWX/1,1/forecast/hourly') {
        return jsonResponse({
          properties: {
            generatedAt: '2026-03-24T12:00:00+00:00',
            periods: [
              {
                name: 'This Hour',
                startTime: '2026-03-24T12:00:00+00:00',
                endTime: '2026-03-24T13:00:00+00:00',
                temperature: 72,
                temperatureUnit: 'F',
                windSpeed: '8 mph',
                windDirection: 'S',
                shortForecast: 'Mostly Sunny',
                detailedForecast: 'Mostly sunny and warm.',
              },
              {
                name: '+1 Hour',
                startTime: '2026-03-24T13:00:00+00:00',
                endTime: '2026-03-24T14:00:00+00:00',
                temperature: 74,
                temperatureUnit: 'F',
                windSpeed: '10 mph',
                windDirection: 'S',
                shortForecast: 'Sunny',
                detailedForecast: 'Sunny and breezy.',
              },
            ],
          },
        })
      }

      if (url === 'http://localhost:8000/health') {
        return new Response(null, { status: 200 })
      }

      if (url === 'http://localhost:8000/artifacts/meteogram') {
        artifactRequestBody = JSON.parse(String(init?.body ?? '{}'))
        return jsonResponse({
          artifactId: 'meteogram-remote.svg',
          title: 'Meteogram for Austin, TX',
          href: '/api/artifacts/meteogram-remote.svg',
          mimeType: 'image/svg+xml',
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const artifact = await generateArtifact(app, {
      artifactType: 'meteogram',
      locationQuery: 'Austin, TX',
      prompt: 'Next 12 hours',
    })

    expect(artifact.artifactId).toBe('meteogram-remote.svg')
    expect(artifactRequestBody).toMatchObject({
      artifactType: 'meteogram',
      prompt: 'Next 12 hours',
      location: {
        latitude: 30.2672,
        longitude: -97.7431,
        name: 'Austin, TX',
      },
    })
    expect(artifactRequestBody.chartPoints).toEqual([
      { label: 'This Hour', value: 72 },
      { label: '+1 Hour', value: 74 },
    ])
  })

  it('falls back to a local radar-loop artifact when the weather service does not support the type', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'http://localhost:8000/health') {
        return new Response(null, { status: 200 })
      }

      if (url === 'http://localhost:8000/artifacts/radar-loop') {
        return new Response('not found', { status: 404 })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const artifact = await generateArtifact(app, {
      artifactType: 'radar-loop',
      locationQuery: 'Austin, TX',
      prompt: 'Current storm structure',
    })

    expect(artifact.mimeType).toBe('text/html')
    expect(artifact.title).toContain('Radar Loop')
  })
})
