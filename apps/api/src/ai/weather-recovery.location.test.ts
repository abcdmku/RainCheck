import { describe, expect, it, vi } from 'vitest'

const {
  getRadarSatelliteNowcastMock,
  getSevereContextMock,
  getShortRangeGuidanceMock,
  synthesizeWeatherConclusionMock,
} = vi.hoisted(() => ({
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

vi.mock('../weather/synthesis', () => ({
  synthesizeWeatherConclusion: synthesizeWeatherConclusionMock,
}))

import { recoverWeatherToolResults } from './weather-recovery'

describe('recoverWeatherToolResults', () => {
  it('uses the resolved location result for severe-weather recovery fetches', async () => {
    const severeEnvelope = {
      summary:
        'SPC keeps northern Illinois in the enhanced severe corridor late Thursday afternoon and evening.',
      confidence: 0.9,
      sourceId: 'spc',
      sourceName: 'SPC',
      retrievedAt: new Date().toISOString(),
      location: {
        query: 'Yorkville, IL',
        name: 'Yorkville, Illinois, United States',
        latitude: 41.64114,
        longitude: -88.44729,
        resolvedBy: 'open-meteo-geocoding',
      },
      normalizedForecast: {
        domain: 'severe-context',
        headline: 'SPC severe context headline.',
        mostLikelyScenario: 'Storms become more chase-worthy late afternoon.',
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

    const shortRangeEnvelope = {
      ...severeEnvelope,
      sourceId: 'href',
      sourceName: 'Short-range guidance',
      normalizedForecast: {
        ...severeEnvelope.normalizedForecast,
        domain: 'short-range-guidance',
      },
    }

    const nowcastEnvelope = {
      ...severeEnvelope,
      sourceId: 'nexrad',
      sourceName: 'Radar, satellite, and nowcast context',
      normalizedForecast: {
        ...severeEnvelope.normalizedForecast,
        domain: 'radar-satellite-nowcast',
      },
    }

    getSevereContextMock.mockResolvedValue(severeEnvelope)
    getShortRangeGuidanceMock.mockResolvedValue(shortRangeEnvelope)
    getRadarSatelliteNowcastMock.mockResolvedValue(nowcastEnvelope)
    synthesizeWeatherConclusionMock.mockReturnValue({
      bottomLine: 'From Yorkville, treat late afternoon into evening as the main chase window.',
      confidence: { level: 'medium', reason: 'SPC and nowcast context align.' },
      mostLikelyScenario:
        'Storms become most chase-worthy late afternoon into evening if they stay discrete.',
      keySignals: [],
      conflicts: [],
      whatWouldChangeTheForecast: [],
      recommendedArtifacts: [],
      productCards: [],
      citations: [],
      artifacts: [],
    })

    const result = await recoverWeatherToolResults(
      {} as any,
      {
        taskClass: 'chat',
        intent: 'severe-weather',
        timeHorizonHours: 6,
        locationRequired: true,
        needsArtifact: false,
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

    expect(getSevereContextMock).toHaveBeenCalledWith({} as any, 'Yorkville, IL')
    expect(getShortRangeGuidanceMock).toHaveBeenCalledWith(
      {} as any,
      'Yorkville, IL',
    )
    expect(getRadarSatelliteNowcastMock).toHaveBeenCalledWith(
      {} as any,
      'Yorkville, IL',
    )
    expect(
      result.some((entry) => entry.toolName === 'synthesize_weather_conclusion'),
    ).toBe(true)
  })
})
