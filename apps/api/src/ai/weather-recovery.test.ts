import { afterEach, describe, expect, it, vi } from 'vitest'

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

describe('recoverWeatherToolResults', () => {
  afterEach(() => {
    deriveRadarNowcastMock.mockReset()
    deriveShortRangeWeatherMock.mockReset()
    geocodeQueryMock.mockReset()
    synthesizeWeatherConclusionMock.mockReset()
  })

  it('rebuilds short-range and radar derive calls before synthesizing a weather conclusion', async () => {
    geocodeQueryMock.mockResolvedValue({
      query: 'Yorkville, IL',
      name: 'Yorkville, Illinois, United States',
      latitude: 41.64114,
      longitude: -88.44729,
      region: 'Illinois',
      country: 'United States',
      resolvedBy: 'open-meteo-geocoding',
    })
    deriveShortRangeWeatherMock.mockResolvedValue({
      agreementSummary: 'Short-range guidance and observations support the same severe corridor.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['hrrr', 'href'],
      sourcesMissing: [],
    })
    deriveRadarNowcastMock.mockResolvedValue({
      agreementSummary: 'Radar and MRMS support the same near-term trend.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['nexrad', 'mrms'],
      sourcesMissing: [],
    })
    synthesizeWeatherConclusionMock.mockResolvedValue({
      bottomLine:
        'From Yorkville, the best-supported call is a late-afternoon severe window.',
      mostLikelyScenario:
        'Discrete storms remain the leading mode into the evening.',
      alternateScenarios: [],
      confidence: {
        level: 'medium',
        reason: 'Short-range and radar evidence align.',
      },
      agreementSummary: 'Short-range and radar evidence align.',
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
        chaseGuidanceLevel: 'general-target',
      },
      'im in yorkville il whats the best plan to follow these upcoming storms to chase a tornado',
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

    expect(geocodeQueryMock).toHaveBeenCalledWith({} as any, 'Yorkville, IL')
    expect(deriveShortRangeWeatherMock).toHaveBeenCalledTimes(1)
    expect(deriveRadarNowcastMock).toHaveBeenCalledTimes(1)
    expect(synthesizeWeatherConclusionMock).toHaveBeenCalledTimes(1)
    expect(
      result.some((entry) => entry.toolName === 'synthesize_weather_conclusion'),
    ).toBe(true)
  })

  it('recovers severe-weather evidence from the raw Yorkville prompt when no location tool result exists yet', async () => {
    geocodeQueryMock.mockResolvedValue({
      query: 'yorkville il',
      name: 'Yorkville, Illinois, United States',
      latitude: 41.64114,
      longitude: -88.44729,
      region: 'Illinois',
      country: 'United States',
      resolvedBy: 'open-meteo-geocoding',
    })
    deriveShortRangeWeatherMock.mockResolvedValue({
      agreementSummary:
        'Short-range guidance supports a late-afternoon to evening severe corridor southwest of Yorkville.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['hrrr', 'href'],
      sourcesMissing: [],
    })
    deriveRadarNowcastMock.mockResolvedValue({
      agreementSummary: 'Radar and MRMS support the same near-term storm trend.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['nexrad', 'mrms'],
      sourcesMissing: [],
    })
    synthesizeWeatherConclusionMock.mockResolvedValue({
      bottomLine:
        'From Yorkville, start near the southwest corridor from Yorkville during the late-afternoon window and stay flexible on the exact storm track.',
      mostLikelyScenario:
        'Discrete storms remain the leading mode before clustering later in the evening.',
      alternateScenarios: [],
      confidence: {
        level: 'medium',
        reason: 'Short-range and radar evidence align on the broader corridor.',
      },
      agreementSummary: 'Short-range and radar evidence align.',
      keySupportingSignals: ['Short-range and radar agree on the broader corridor.'],
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
        chaseGuidanceLevel: 'general-target',
      },
      'im in yorkville il whats the best plan to follow these upcoming storms to chase a tornado. what time and where should i start the chase',
      [],
    )

    expect(geocodeQueryMock).toHaveBeenCalledWith({} as any, 'yorkville il')
    expect(deriveShortRangeWeatherMock).toHaveBeenCalledTimes(1)
    expect(deriveRadarNowcastMock).toHaveBeenCalledTimes(1)
    expect(
      result.some((entry) => entry.toolName === 'synthesize_weather_conclusion'),
    ).toBe(true)
  })
})
