import { describe, expect, it, vi } from 'vitest'

const {
  generateArtifactMock,
  getRadarSatelliteNowcastMock,
  getSevereContextMock,
  getShortRangeGuidanceMock,
  synthesizeWeatherConclusionMock,
} = vi.hoisted(() => ({
  generateArtifactMock: vi.fn(),
  getSevereContextMock: vi.fn(),
  getShortRangeGuidanceMock: vi.fn(),
  getRadarSatelliteNowcastMock: vi.fn(),
  synthesizeWeatherConclusionMock: vi.fn(),
}))

vi.mock('../weather/domain-tools', () => ({
  getPrecipFloodContext: vi.fn(),
  getRadarSatelliteNowcast: getRadarSatelliteNowcastMock,
  getSevereContext: getSevereContextMock,
}))

vi.mock('../weather/models', () => ({
  getGlobalGuidance: vi.fn(),
  getShortRangeGuidance: getShortRangeGuidanceMock,
}))

vi.mock('../weather/service-client', () => ({
  generateArtifact: generateArtifactMock,
}))

vi.mock('../weather/synthesis', () => ({
  synthesizeWeatherConclusion: synthesizeWeatherConclusionMock,
}))

import {
  buildWeatherFallbackText,
  recoverWeatherToolResults,
} from './weather-recovery'

function severeEnvelope(sourceId = 'spc', sourceName = 'SPC') {
  return {
    summary:
      'Northern Illinois stays in the enhanced severe corridor late Thursday afternoon and evening.',
    confidence: 0.9,
    sourceId,
    sourceName,
    retrievedAt: new Date().toISOString(),
    location: {
      query: 'Yorkville, IL',
      name: 'Yorkville, Illinois, United States',
      latitude: 41.64114,
      longitude: -88.44729,
      resolvedBy: 'open-meteo-geocoding',
    },
    normalizedForecast: {
      domain: sourceId,
      headline: 'Severe headline.',
      mostLikelyScenario:
        'Storms become most organized late Thursday afternoon and evening.',
      alternateScenarios: [],
      confidence: 'medium',
      likelihood: 'medium',
      keySignals: [],
      conflicts: [],
      failureModes: [],
      whatWouldChange: [],
      productCards: [],
      recommendedProductIds: [],
    },
    data: {},
    citations: [],
  }
}

describe('weather recovery visual cleanup', () => {
  it('keeps synthesized fallback text from repeating most likely phrasing', () => {
    const text = buildWeatherFallbackText([
      {
        toolCallId: 'tool-1',
        toolName: 'synthesize_weather_conclusion',
        result: {
          bottomLine:
            'From Yorkville, treat late Thursday afternoon and evening as the main severe-weather window.',
          confidence: {
            level: 'medium',
            reason:
              'SPC and nowcast context are aligned enough for a cautious severe-weather brief.',
          },
          mostLikelyScenario:
            'The most likely outcome is organized severe storms arriving later in the afternoon.',
          conflicts: ['Missing source coverage: NEXRAD, GOES.'],
        },
      },
    ])

    expect(text).toContain(
      'The most likely outcome is organized severe storms arriving 3 PM to 6 PM local time.',
    )
    expect(text).not.toContain('Most likely, the most likely outcome')
  })

  it('recovers a supported artifact for visual follow-up requests', async () => {
    getSevereContextMock.mockResolvedValue(severeEnvelope('spc', 'SPC'))
    getShortRangeGuidanceMock.mockResolvedValue(
      severeEnvelope('href', 'Short-range guidance'),
    )
    getRadarSatelliteNowcastMock.mockResolvedValue(
      severeEnvelope('mrms', 'Radar, satellite, and nowcast context'),
    )
    synthesizeWeatherConclusionMock.mockReturnValue({
      bottomLine:
        'From Yorkville, the best-supported call is a late Thursday afternoon and evening severe-weather window.',
      confidence: {
        level: 'medium',
        reason:
          'SPC and short-range guidance align on the broader timing window.',
      },
      mostLikelyScenario:
        'The most likely outcome is organized severe storms arriving from late Thursday afternoon onward.',
      conflicts: ['Missing source coverage: NEXRAD, GOES.'],
      productCards: [],
      citations: [],
      artifacts: [],
    })
    generateArtifactMock.mockResolvedValue({
      artifactId: 'brief-report-1.html',
      type: 'brief-report',
      title: 'RainCheck Brief Report for Yorkville, IL',
      href: '/api/artifacts/brief-report-1.html',
      mimeType: 'text/html',
    })

    const result = await recoverWeatherToolResults(
      {} as any,
      {
        taskClass: 'research',
        intent: 'severe-weather',
        timeHorizonHours: 48,
        locationRequired: true,
        needsArtifact: true,
      },
      'can you show on a map where i should go and mark the times i should be there',
      [
        {
          toolCallId: 'tool-1',
          toolName: 'resolve_location',
          input: {
            locationQuery: 'Yorkville, IL',
          },
          result: {
            query: 'Yorkville, IL',
            name: 'Yorkville, Illinois, United States',
            latitude: 41.64114,
            longitude: -88.44729,
            region: 'Illinois',
            country: 'United States',
            resolvedBy: 'open-meteo-geocoding',
          },
        },
      ],
    )

    expect(generateArtifactMock).toHaveBeenCalledWith(
      {} as any,
      expect.objectContaining({
        artifactType: 'brief-report',
        locationQuery: 'Yorkville, IL',
      }),
    )
    expect(
      result.some((entry) => entry.toolName === 'generate_weather_artifact'),
    ).toBe(true)
  })
})
