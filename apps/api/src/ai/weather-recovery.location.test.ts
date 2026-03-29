import { afterEach, describe, expect, it, vi } from 'vitest'

const {
  deriveRadarNowcastMock,
  deriveShortRangeWeatherMock,
  geocodeQueryMock,
  resolveOriginLocationMock,
  selectBroadChaseTargetMock,
  synthesizeWeatherConclusionMock,
} = vi.hoisted(() => ({
  deriveRadarNowcastMock: vi.fn(),
  deriveShortRangeWeatherMock: vi.fn(),
  geocodeQueryMock: vi.fn(),
  resolveOriginLocationMock: vi.fn(),
  selectBroadChaseTargetMock: vi.fn(),
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

vi.mock('../weather/chase-targeting', () => ({
  isBroadSevereLocatorQuestion: (
    classification: { intent: string; locationRequired: boolean },
  ) => classification.intent === 'severe-weather' && !classification.locationRequired,
  resolveOriginLocation: resolveOriginLocationMock,
  selectBroadChaseTarget: selectBroadChaseTargetMock,
}))

import { recoverWeatherToolResults } from './weather-recovery'

describe('weather recovery location handling', () => {
  afterEach(() => {
    deriveRadarNowcastMock.mockReset()
    deriveShortRangeWeatherMock.mockReset()
    geocodeQueryMock.mockReset()
    resolveOriginLocationMock.mockReset()
    selectBroadChaseTargetMock.mockReset()
    synthesizeWeatherConclusionMock.mockReset()
  })

  it('uses the resolved location result when rebuilding derive requests', async () => {
    resolveOriginLocationMock.mockResolvedValue(null)
    selectBroadChaseTargetMock.mockResolvedValue(null)
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
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
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
    resolveOriginLocationMock.mockResolvedValue({
      query: 'Chicago, IL',
      name: 'Chicago, Illinois, United States',
      latitude: 41.8781,
      longitude: -87.6298,
      region: 'Illinois',
      country: 'United States',
      timezone: 'America/Chicago',
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
        'From Chicago, the best-supported start is Springfield to Bloomington-Normal in central Illinois.',
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
    selectBroadChaseTargetMock.mockResolvedValue({
      severeContextQuery: 'Illinois',
      severeContext: {
        summary: 'SPC outlook support for Illinois.',
        data: { products: [] },
      },
      selectedTarget: {
        query: 'Springfield, Illinois',
        label: 'Springfield to Bloomington-Normal in central Illinois',
        location: {
          query: 'Springfield, Illinois',
          name: 'Springfield, Illinois, United States',
          latitude: 39.7817,
          longitude: -89.6501,
          region: 'Illinois',
          country: 'United States',
          timezone: 'America/Chicago',
          resolvedBy: 'raincheck-regional-anchor',
        },
        regionLabel: 'central Illinois',
        startLabel: 'Springfield',
        stopLabel: 'Bloomington-Normal',
        travelHours: 3,
        corridorHours: 1,
        withinNearbyRadius: true,
        supportScore: 0.78,
      },
      nightfall: {
        event: 'civil-dusk',
        occursAt: '2026-03-26T00:15:00Z',
      },
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
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
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
      {
        answerTone: 'casual',
        timeDisplay: 'user-local',
        displayTimezone: 'America/Chicago',
        locationHint: {
          label: 'Chicago, IL',
        },
      },
    )

    expect(selectBroadChaseTargetMock).toHaveBeenCalled()
    expect(synthesizeWeatherConclusionMock).toHaveBeenCalledWith(
      {} as any,
      expect.objectContaining({
        displayTimezone: 'America/Chicago',
        timeDisplay: 'user-local',
        selectedTarget: expect.objectContaining({
          label: 'Springfield to Bloomington-Normal in central Illinois',
        }),
      }),
    )
  })

  it('uses the saved location hint when an SPC follow-up does not name a place', async () => {
    resolveOriginLocationMock.mockResolvedValue(null)
    selectBroadChaseTargetMock.mockResolvedValue(null)
    geocodeQueryMock.mockResolvedValue({
      query: 'Chicago, IL',
      name: 'Chicago, Illinois, United States',
      latitude: 41.8781,
      longitude: -87.6298,
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
        'For Chicago, the broader severe setup this period is still centered near the Illinois corridor.',
      mostLikelyScenario: 'The leading scenario is a broader Illinois severe corridor.',
      alternateScenarios: [],
      confidence: { level: 'medium', reason: 'SPC and short-range guidance agree.' },
      agreementSummary: 'SPC and short-range guidance agree.',
      keySupportingSignals: ['SPC and short-range guidance agree.'],
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
        timeHorizonHours: 72,
        locationRequired: true,
        needsArtifact: false,
        chaseGuidanceLevel: 'analysis-only',
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
      },
      'check day 2 and 3 of spc',
      [],
      {
        answerTone: 'casual',
        timeDisplay: 'user-local',
        displayTimezone: 'America/Chicago',
        locationHint: {
          label: 'Chicago, IL',
          latitude: 41.8781,
          longitude: -87.6298,
        },
      },
    )

    expect(geocodeQueryMock).toHaveBeenCalledWith({} as any, '41.8781, -87.6298')
    expect(synthesizeWeatherConclusionMock).toHaveBeenCalledTimes(1)
  })
})
