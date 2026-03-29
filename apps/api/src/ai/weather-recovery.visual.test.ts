import { describe, expect, it, vi } from 'vitest'

const {
  deriveRadarNowcastMock,
  deriveShortRangeWeatherMock,
  generateArtifactMock,
  geocodeQueryMock,
  synthesizeWeatherConclusionMock,
} = vi.hoisted(() => ({
  deriveRadarNowcastMock: vi.fn(),
  deriveShortRangeWeatherMock: vi.fn(),
  generateArtifactMock: vi.fn(),
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
  generateArtifact: generateArtifactMock,
  synthesizeWeatherConclusion: synthesizeWeatherConclusionMock,
}))

import {
  buildWeatherFallbackText,
  recoverWeatherToolResults,
} from './weather-recovery'

describe('weather recovery visual cleanup', () => {
  it('keeps synthesized fallback text compact and source-grounded', () => {
    const text = buildWeatherFallbackText([
      {
        toolCallId: 'tool-1',
        toolName: 'synthesize_weather_conclusion',
        result: {
          bottomLine:
            'From Yorkville, the best-supported call is a late-afternoon severe window.',
          confidence: {
            level: 'medium',
            reason:
              'Short-range and radar evidence line up on the main window.',
          },
          mostLikelyScenario:
            'Discrete storms remain the leading mode into the evening.',
          agreementSummary: 'Short-range and radar evidence line up.',
          keyConflicts: ['The warm front may still wobble south.'],
          bustRisks: ['A southward boundary shift would lower tornado odds.'],
          recommendedCards: [],
        },
      },
    ])

    expect(text).not.toBeNull()
    const fallback = text ?? ''

    expect(fallback).toContain(
      'From Yorkville, the best-supported call is a 4 PM to 6 PM local time severe window.',
    )
    expect(fallback).toContain(
      'Separate storms remain the leading mode until 10 PM local time.',
    )
    expect(fallback).toContain('The warm front may still wobble south.')
    expect(fallback).not.toContain('Confidence:')
    expect(fallback).not.toContain('Why RainCheck thinks that:')
    expect(fallback).not.toContain('Agreement:')
    expect(fallback).not.toContain('..')
  })

  it('drops repetitive chase guidance phrases from fallback text', () => {
    const text = buildWeatherFallbackText([
      {
        toolCallId: 'tool-1',
        toolName: 'synthesize_weather_conclusion',
        result: {
          bottomLine:
            'From Yorkville, start near the south to southwest corridor from Yorkville during the 5 PM to 11 PM UTC window and stay ready to adjust with the strongest boundary-focused storms.',
          confidence: {
            level: 'medium',
            reason:
              'Short-range and radar evidence line up on the broader corridor.',
          },
          mostLikelyScenario:
            'The main chase start window is 5 PM to 11 PM UTC, with the favored starting corridor centered on the south to southwest corridor from Yorkville; if storms cluster earlier than expected, widen back to the broader Yorkville area.',
          agreementSummary:
            'Short Range evidence for Yorkville is led by RTMA, SPC, HREF.',
          keyConflicts: [
            'Warm-front or outflow placement can still shift the highest tornado-supportive corridor.',
          ],
          bustRisks: [
            'Warm-front or outflow placement can still shift the highest tornado-supportive corridor.',
          ],
          recommendedCards: [],
        },
      },
    ])

    expect(text).not.toBeNull()
    const fallback = text ?? ''

    expect(fallback).toContain(
      'It is still a conditional call because short-range and radar evidence line up on the broader corridor.',
    )
    expect(fallback).toContain(
      'Warm-front or outflow placement can still shift the highest tornado-supportive corridor.',
    )
    expect(fallback).not.toContain('Confidence:')
    expect(fallback).not.toContain('Main uncertainty:')
    expect(fallback).not.toContain('Agreement:')
    expect(fallback).not.toContain('..')
    expect(
      fallback.match(/south to southwest corridor from Yorkville/gi)?.length ?? 0,
    ).toBe(1)
    expect(
      fallback.match(/Warm-front or outflow placement can still shift/gi)
        ?.length ?? 0,
    ).toBe(1)
  })

  it('renders compare bundles as natural prose instead of stitched fragments', () => {
    const text = buildWeatherFallbackText([
      {
        toolCallId: 'tool-compare',
        toolName: 'compare_weather_candidates',
        result: {
          answerMode: 'compare',
          rankingObjective: 'severe-favorability',
          rankLimit: 2,
          bottomLine:
            'Paxton looks more favorable than Bloomington for severe favorability right now.',
          confidence: {
            level: 'medium',
            reason: 'The lead is modest but supported.',
          },
          whyRainCheckThinksThat:
            'RainCheck weighted storm-scale radar support, short-range severe signal, official severe context, and conflict penalties across each candidate.',
          sharedUncertainty:
            'Boundary placement can still shift the strongest tornado-supportive corridor.',
          rankedCandidates: [
            {
              candidate: {
                query: 'Paxton, IL',
                label: 'Paxton, IL',
                location: {
                  query: 'Paxton, IL',
                  name: 'Paxton, Illinois, United States',
                  latitude: 40.46,
                  longitude: -88.09,
                  resolvedBy: 'pytest',
                },
                source: 'user',
              },
              rank: 1,
              score: 0.7,
              confidence: {
                level: 'medium',
                reason: 'Candidate evidence is reasonably complete.',
              },
              summary:
                'Paxton, IL keeps the stronger tornado-supportive storm signal right now.',
              why:
                'Radar and MRMS support is currently sharper here than the nearby alternatives.',
              supportingSignals: [],
              conflicts: [],
              recommendedCards: [],
            },
          ],
          recommendedCards: [],
          citations: [],
        },
      },
    ])

    expect(text).toContain(
      'Paxton looks more favorable than Bloomington for severe favorability right now.',
    )
    expect(text).toContain(
      'Radar and MRMS support is currently sharper here than the nearby alternatives.',
    )
    expect(text).toContain(
      'Boundary placement can still shift the strongest tornado-supportive corridor.',
    )
    expect(text).not.toContain('Confidence:')
    expect(text).not.toContain('Why RainCheck thinks that:')
    expect(text).not.toContain('Main uncertainty:')
    expect(text).not.toContain('RTMA keeps')
    expect(text).not.toContain('..')
  })

  it('recovers a supported artifact for visual follow-up requests', async () => {
    geocodeQueryMock.mockResolvedValue({
      query: 'Yorkville, IL',
      name: 'Yorkville, Illinois, United States',
      latitude: 41.64114,
      longitude: -88.44729,
      resolvedBy: 'open-meteo-geocoding',
    })
    deriveShortRangeWeatherMock.mockResolvedValue({
      agreementSummary: 'Short-range guidance supports the same severe corridor.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['hrrr'],
      sourcesMissing: [],
    })
    deriveRadarNowcastMock.mockResolvedValue({
      agreementSummary: 'Radar and MRMS reinforce the near-term trend.',
      evidenceProducts: [],
      keyConflicts: [],
      recommendedCards: [],
      recommendedArtifacts: [],
      sourcesUsed: ['nexrad', 'mrms'],
      sourcesMissing: [],
    })
    synthesizeWeatherConclusionMock.mockResolvedValue({
      bottomLine:
        'From Yorkville, the best-supported call is a late Thursday afternoon and evening severe-weather window.',
      confidence: {
        level: 'medium',
        reason:
          'Short-range guidance and radar line up on the broader timing window.',
      },
      mostLikelyScenario:
        'Discrete storms are the leading mode if they stay separated.',
      agreementSummary: 'Short-range guidance and radar line up.',
      keyConflicts: ['The exact initiation corridor can still shift.'],
      bustRisks: ['A boundary shift would move the corridor.'],
      recommendedCards: [],
      citations: [],
      evidenceProducts: [],
      recommendedArtifacts: [],
      keySupportingSignals: ['Short-range guidance and radar line up.'],
      alternateScenarios: [],
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
        chaseGuidanceLevel: 'general-target',
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
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
