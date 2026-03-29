import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  buildComparisonLimitationContextMock,
  deriveRadarNowcastMock,
  deriveShortRangeWeatherMock,
  geocodeQueryMock,
  runWeatherComparisonMock,
  synthesizeWeatherConclusionMock,
} = vi.hoisted(() => ({
  buildComparisonLimitationContextMock: vi.fn(),
  deriveRadarNowcastMock: vi.fn(),
  deriveShortRangeWeatherMock: vi.fn(),
  geocodeQueryMock: vi.fn(),
  runWeatherComparisonMock: vi.fn(),
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

vi.mock('../weather/comparison', () => ({
  buildComparisonLimitationContext: buildComparisonLimitationContextMock,
  isWeatherComparisonBundle: (value: any) =>
    value != null &&
    typeof value === 'object' &&
    typeof value.bottomLine === 'string' &&
    Array.isArray(value.rankedCandidates),
  runWeatherComparison: runWeatherComparisonMock,
}))

import { recoverWeatherToolResults } from './weather-recovery'

describe('recoverWeatherToolResults', () => {
  afterEach(() => {
    buildComparisonLimitationContextMock.mockReset()
    deriveRadarNowcastMock.mockReset()
    deriveShortRangeWeatherMock.mockReset()
    geocodeQueryMock.mockReset()
    runWeatherComparisonMock.mockReset()
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
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
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
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
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

  it('routes compare recovery through the comparison bundle path', async () => {
    runWeatherComparisonMock.mockResolvedValue({
      answerMode: 'compare',
      rankingObjective: 'severe-favorability',
      rankLimit: 2,
      bottomLine:
        'Paxton looks more favorable than Bloomington for severe favorability right now.',
      confidence: {
        level: 'medium',
        reason: 'The leading candidate separates modestly from the rest.',
      },
      whyRainCheckThinksThat:
        'RainCheck weighted storm-scale radar support, short-range severe signal, official severe context, and conflict penalties across each candidate.',
      rankedCandidates: [],
      recommendedCards: [],
      citations: [],
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
        answerMode: 'compare',
        candidateMode: 'named',
        rankLimit: 2,
        rankingObjective: 'severe-favorability',
      },
      'compare bloomington il and paxton il. which one looks more favorable to spawn a tornado?',
      [],
    )

    expect(runWeatherComparisonMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual([
      expect.objectContaining({
        toolName: 'compare_weather_candidates',
        result: expect.objectContaining({
          bottomLine:
            'Paxton looks more favorable than Bloomington for severe favorability right now.',
        }),
      }),
    ])
  })

  it('keeps comparison context on limitation bundles so location-only follow-ups can recover', async () => {
    runWeatherComparisonMock.mockResolvedValue(null)
    buildComparisonLimitationContextMock.mockResolvedValue({
      workflow: 'forecast',
      answerMode: 'rank',
      candidateMode: 'discovered',
      rankLimit: 5,
      rankingObjective: 'beach-day',
      candidates: [],
    })

    const result = await recoverWeatherToolResults(
      {} as any,
      {
        taskClass: 'chat',
        intent: 'forecast',
        timeHorizonHours: 48,
        locationRequired: false,
        needsArtifact: false,
        chaseGuidanceLevel: 'analysis-only',
        answerMode: 'rank',
        candidateMode: 'discovered',
        rankLimit: 5,
        rankingObjective: 'beach-day',
      },
      'best area for beaches and when',
      [],
    )

    expect(buildComparisonLimitationContextMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual([
      expect.objectContaining({
        toolName: 'compare_weather_candidates',
        result: expect.objectContaining({
          comparisonContext: expect.objectContaining({
            workflow: 'forecast',
            answerMode: 'rank',
            candidateMode: 'discovered',
            rankingObjective: 'beach-day',
          }),
        }),
      }),
    ])
  })
})
