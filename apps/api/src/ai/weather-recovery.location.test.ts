import { describe, expect, it, vi } from 'vitest'

const {
  deriveRadarNowcastMock,
  deriveShortRangeWeatherMock,
  geocodeQueryMock,
  synthesizeWeatherConclusionMock,
} = vi.hoisted(() => ({
  deriveRadarNowcastMock: vi.fn(),
  deriveShortRangeWeatherMock: vi.fn(),
  geocodeQueryMock: vi.fn(),
  synthesizeWeatherConclusionMock: vi.fn(),
}))

vi.mock('../weather/geocode', () => ({
  geocodeQuery: geocodeQueryMock,
}))

vi.mock('../weather/service-client', () => ({
  deriveGlobalWeather: vi.fn(),
  deriveHydrologyWeather: vi.fn(),
  deriveRadarNowcast: deriveRadarNowcastMock,
  deriveSatelliteWeather: vi.fn(),
  deriveShortRangeWeather: deriveShortRangeWeatherMock,
  generateArtifact: vi.fn(),
  synthesizeWeatherConclusion: synthesizeWeatherConclusionMock,
}))

import { recoverWeatherToolResults } from './weather-recovery'

describe('weather recovery location handling', () => {
  it('uses the resolved location result when rebuilding derive requests', async () => {
    geocodeQueryMock.mockResolvedValue({
      query: 'Central IL',
      name: 'Illinois, United States',
      latitude: 40,
      longitude: -89,
      resolvedBy: 'open-meteo-geocoding',
    })
    deriveShortRangeWeatherMock.mockResolvedValue({
      agreementSummary: 'Short-range guidance supports the same corridor.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['hrrr'],
      sourcesMissing: [],
    })
    deriveRadarNowcastMock.mockResolvedValue({
      agreementSummary: 'Radar shows the near-term trend.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['nexrad'],
      sourcesMissing: [],
    })
    synthesizeWeatherConclusionMock.mockResolvedValue({
      bottomLine: 'From Illinois, the best-supported call is a severe corridor later today.',
      mostLikelyScenario: 'The leading scenario is discrete storms.',
      alternateScenarios: [],
      confidence: { level: 'medium', reason: 'Short-range and radar agree.' },
      agreementSummary: 'Short-range and radar agree.',
      keySupportingSignals: ['Short-range and radar agree.'],
      keyConflicts: [],
      bustRisks: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      citations: [],
      evidenceProducts: [],
    })

    const result = await recoverWeatherToolResults(
      {} as any,
      {
        taskClass: 'research',
        intent: 'severe-weather',
        timeHorizonHours: 6,
        locationRequired: true,
        needsArtifact: false,
        chaseGuidanceLevel: 'analysis-only',
      },
      'In central IL where should I avoid because of tornados?',
      [
        {
          toolCallId: 'tool-1',
          toolName: 'resolve_location',
          input: { locationQuery: 'Central IL' },
          result: {
            query: 'Central IL',
            name: 'Illinois, United States',
            latitude: 40,
            longitude: -89,
            resolvedBy: 'open-meteo-geocoding',
          },
        },
      ],
    )

    expect(geocodeQueryMock).toHaveBeenCalledWith({} as any, 'Central IL')
    expect(
      result.some((entry) => entry.toolName === 'synthesize_weather_conclusion'),
    ).toBe(true)
  })

  it('broadens current-location storm hunts to the containing region before recovery derives', async () => {
    geocodeQueryMock.mockResolvedValue({
      query: 'Illinois',
      name: 'Illinois, United States',
      latitude: 40,
      longitude: -89,
      region: 'Illinois',
      country: 'United States',
      resolvedBy: 'open-meteo-geocoding',
    })
    deriveShortRangeWeatherMock.mockResolvedValue({
      agreementSummary: 'Short-range guidance supports the broader Illinois corridor.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['hrrr'],
      sourcesMissing: [],
    })
    deriveRadarNowcastMock.mockResolvedValue({
      agreementSummary: 'Radar shows the near-term trend.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['nexrad'],
      sourcesMissing: [],
    })
    synthesizeWeatherConclusionMock.mockResolvedValue({
      bottomLine:
        'The best-supported starting corridor today is within Illinois.',
      mostLikelyScenario: 'The leading scenario is discrete storms.',
      alternateScenarios: [],
      confidence: { level: 'medium', reason: 'Short-range and radar agree.' },
      agreementSummary: 'Short-range and radar agree.',
      keySupportingSignals: ['Short-range and radar agree.'],
      keyConflicts: [],
      bustRisks: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      citations: [],
      evidenceProducts: [],
    })

    await recoverWeatherToolResults(
      {} as any,
      {
        taskClass: 'research',
        intent: 'severe-weather',
        timeHorizonHours: 6,
        locationRequired: false,
        needsArtifact: false,
        chaseGuidanceLevel: 'general-target',
      },
      'where is the best spot to start chasing the storms today and what time should i get there',
      [
        {
          toolCallId: 'tool-1',
          toolName: 'resolve_location',
          input: { locationQuery: 'Chicago, IL' },
          result: {
            query: 'Chicago, IL',
            name: 'Chicago, Illinois, United States',
            latitude: 41.8781,
            longitude: -87.6298,
            region: 'Illinois',
            country: 'United States',
            resolvedBy: 'open-meteo-geocoding',
          },
        },
      ],
    )

    expect(geocodeQueryMock).toHaveBeenCalledWith({} as any, 'Illinois')
  })
})
