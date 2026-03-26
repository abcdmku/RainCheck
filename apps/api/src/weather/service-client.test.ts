import { parseEnv } from '@raincheck/config'
import type { FastifyInstance } from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { clearWeatherCache } from './runtime'
import {
  deriveShortRangeWeather,
  generateArtifact,
  synthesizeWeatherConclusion,
} from './service-client'

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

describe('weather service client', () => {
  afterEach(() => {
    clearWeatherCache()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('posts high-level short-range derivation requests to the Python service', async () => {
    let deriveRequestBody: any = null
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: any) => {
      const url = String(input)

      if (url === 'http://localhost:8000/derive/short-range') {
        deriveRequestBody = JSON.parse(String(init?.body ?? '{}'))
        return jsonResponse({
          workflow: 'severe-weather',
          region: {
            type: 'point',
            location: {
              query: 'Austin, TX',
              name: 'Austin, Texas, United States',
              latitude: 30.2672,
              longitude: -97.7431,
              resolvedBy: 'geocoded',
            },
          },
          analysisWindow: {
            start: '2026-03-25T18:00:00Z',
            end: '2026-03-25T22:00:00Z',
            referenceTime: null,
            recentHours: null,
          },
          evidenceProducts: [
            {
              id: 'evidence-1',
              sourceFamily: 'hrrr',
              sourceName: 'HRRR',
              cycleTime: '2026-03-25T18:00:00Z',
              validTime: '2026-03-25T21:00:00Z',
              geometry: {
                type: 'point',
                latitude: 30.2672,
                longitude: -97.7431,
              },
              fieldName: 'storm-mode',
              fieldType: 'derived_diagnostic',
              level: null,
              units: 'categorical',
              spatialResolution: null,
              summary: 'HRRR supports a discrete supercell mode near the leading corridor.',
              summaryStats: {},
              signalScore: 0.76,
              confidence: 0.72,
              provenance: [],
              artifactHandles: [],
            },
          ],
          agreementSummary: 'HRRR and HREF support the same severe corridor.',
          keyConflicts: [],
          recommendedCards: [
            {
              id: 'card-1',
              title: 'HRRR storm mode',
              sourceId: 'hrrr',
              sourceName: 'HRRR',
              summary: 'HRRR keeps the leading storms discrete early in the window.',
              imageUrl: null,
              artifactId: null,
              href: null,
              mimeType: null,
              relevance: 'primary',
            },
          ],
          recommendedArtifacts: [],
          sourcesUsed: ['hrrr', 'href'],
          sourcesMissing: [],
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await deriveShortRangeWeather(app, {
      userQuestion: 'What is the storm mode by 00z?',
      workflow: 'severe-weather',
      domain: 'storm-mode',
      region: {
        type: 'point',
        location: {
          query: 'Austin, TX',
          name: 'Austin, Texas, United States',
          latitude: 30.2672,
          longitude: -97.7431,
          resolvedBy: 'geocoded',
        },
        radiusKm: 120,
      },
      timeWindow: {
        start: '2026-03-25T18:00:00Z',
        end: '2026-03-25T22:00:00Z',
        recentHours: 4,
      },
      requestedArtifacts: [],
      includeOfficialContext: true,
      focus: 'storm mode',
      variables: ['cape', 'shear'],
    })

    expect(deriveRequestBody).toMatchObject({
      workflow: 'severe-weather',
      domain: 'storm-mode',
      focus: 'storm mode',
      variables: ['cape', 'shear'],
    })
    expect(result.agreementSummary).toContain('HRRR and HREF')
    expect(result.analysisWindow.referenceTime).toBeUndefined()
    expect(result.analysisWindow.recentHours).toBeUndefined()
    expect(result.evidenceProducts[0]?.level).toBeUndefined()
    expect(result.evidenceProducts[0]?.spatialResolution).toBeUndefined()
    expect(result.recommendedCards[0]?.imageUrl).toBeUndefined()
  })

  it('posts synthesis requests directly to the Python service', async () => {
    let synthesisRequestBody: any = null
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: any) => {
      const url = String(input)

      if (url === 'http://localhost:8000/synthesize') {
        synthesisRequestBody = JSON.parse(String(init?.body ?? '{}'))
        return jsonResponse({
          bottomLine: 'The best-supported call is a severe-weather window late today.',
          mostLikelyScenario: 'Discrete storms remain the leading mode.',
          alternateScenarios: [],
          confidence: {
            level: 'medium',
            reason: 'Short-range and radar evidence agree.',
          },
          agreementSummary: 'Short-range and radar agree.',
          keySupportingSignals: ['Short-range guidance favors a discrete mode.'],
          keyConflicts: [],
          bustRisks: [],
          recommendedCards: [],
          recommendedArtifacts: [],
          citations: [],
          evidenceProducts: [],
        })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await synthesizeWeatherConclusion(app, {
      userQuestion: 'What is the most likely storm mode by 00z?',
      workflow: 'severe-weather',
      region: {
        type: 'point',
        location: {
          query: 'Austin, TX',
          name: 'Austin, Texas, United States',
          latitude: 30.2672,
          longitude: -97.7431,
          resolvedBy: 'geocoded',
        },
        radiusKm: 120,
      },
      timeWindow: {
        start: '2026-03-25T18:00:00Z',
        end: '2026-03-25T22:00:00Z',
        recentHours: 4,
      },
      evidenceProducts: [],
      supportingBundles: [],
    })

    expect(synthesisRequestBody).toMatchObject({
      workflow: 'severe-weather',
      userQuestion: 'What is the most likely storm mode by 00z?',
    })
    expect(result.confidence.level).toBe('medium')
  })

  it('throws when the weather service rejects an artifact request instead of fabricating a fallback', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)

      if (url === 'http://localhost:8000/health') {
        return new Response(null, { status: 200 })
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
            ],
          },
        })
      }

      if (url === 'http://localhost:8000/artifacts/radar-loop') {
        return new Response('not found', { status: 404 })
      }

      throw new Error(`Unexpected fetch URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      generateArtifact(app, {
        artifactType: 'radar-loop',
        locationQuery: 'Austin, TX',
        prompt: 'Current storm structure',
      }),
    ).rejects.toThrow(
      'Weather service request to /artifacts/radar-loop failed with status 404.',
    )
  })
})
