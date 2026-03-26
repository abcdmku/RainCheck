import { describe, expect, it } from 'vitest'

import { synthesizeWeatherConclusion } from './synthesis'

function severeEnvelope() {
  return {
    sourceId: 'spc',
    sourceName: 'SPC convective outlooks',
    retrievedAt: '2026-03-25T18:00:00Z',
    validAt: '2026-03-25T18:00:00Z',
    location: {
      query: 'Yorkville, IL',
      name: 'Yorkville, Illinois, United States',
      latitude: 41.64,
      longitude: -88.45,
      resolvedBy: 'open-meteo-geocoding',
    },
    units: {
      defaultUnit: 'categorical',
    },
    confidence: 0.9,
    summary:
      'SPC Day 2 Convective Outlook: THERE IS AN ENHANCED RISK OF SEVERE THUNDERSTORMS ACROSS PORTIONS OF NORTHERN AND CENTRAL ILLINOIS AND INDIANA INTO WESTERN OHIO. Scattered severe thunderstorms are expected late Thursday afternoon and evening across parts of the Mid-Mississippi and Ohio Valleys. Very large hail, a few tornadoes, and severe wind gusts will be possible.',
    normalizedForecast: {
      domain: 'severe-context',
      headline:
        'The SPC keeps portions of northern and central Illinois in an enhanced risk for severe thunderstorms.',
      mostLikelyScenario:
        'Scattered severe thunderstorms are expected late Thursday afternoon and evening across parts of northern and central Illinois.',
      alternateScenarios: [],
      likelihood: 'high',
      confidence: 'high',
      keySignals: [
        {
          label: 'SPC outlooks',
          detail:
            'Northern and central Illinois remain in the enhanced severe corridor for late Thursday afternoon and evening storms.',
          sourceIds: ['spc'],
          productIds: ['spc-convective-outlooks'],
        },
      ],
      conflicts: [],
      whatWouldChange: [],
      productCards: [],
      recommendedProductIds: [],
    },
    data: {
      products: [
        {
          title: 'SPC Day 2 Convective Outlook',
          riskHeadline:
            'THERE IS AN ENHANCED RISK OF SEVERE THUNDERSTORMS ACROSS PORTIONS OF NORTHERN AND CENTRAL ILLINOIS AND INDIANA INTO WESTERN OHIO',
          summary:
            'Scattered severe thunderstorms are expected late Thursday afternoon and evening across parts of the Mid-Mississippi and Ohio Valleys. Very large hail, a few tornadoes, and severe wind gusts will be possible.',
          locationRelevance:
            'Illinois is explicitly mentioned in this outlook, which includes Yorkville.',
        },
      ],
    },
    citations: [],
  } as any
}

describe('synthesizeWeatherConclusion', () => {
  it('turns severe chase questions into a severe-weather brief without chase routing language', () => {
    const result = synthesizeWeatherConclusion({
      userQuestion:
        'im in yorkville il whats the best plan to follow these upcoming storms to chase a tornado. what time and where should i start the chase',
      workflow: 'severe-weather',
      severeContext: severeEnvelope(),
    })

    expect(result.bottomLine).toContain('From Yorkville')
    expect(result.bottomLine.toLowerCase()).toContain(
      'main severe-weather window',
    )
    expect(result.bottomLine.toLowerCase()).not.toContain('chase')
    expect(result.mostLikelyScenario.toLowerCase()).toContain(
      '4 pm to 10 pm thursday local time',
    )
    expect(result.mostLikelyScenario.toLowerCase()).not.toContain(
      'chase-worthy',
    )
    expect(result.confidence.level).toBe('medium')
  })

  it('explains the closest supported visual when a user asks for an annotated map', () => {
    const result = synthesizeWeatherConclusion({
      userQuestion:
        'can you show on a map where i should go and mark the times i should be there',
      workflow: 'severe-weather',
      severeContext: severeEnvelope(),
    })

    expect(result.bottomLine.toLowerCase()).toContain(
      'official outlook and loop visuals',
    )
    expect(result.bottomLine.toLowerCase()).toContain('annotated chase map')
  })

  it('keeps short-range model questions model-first even when nowcast context is available', () => {
    const result = synthesizeWeatherConclusion({
      userQuestion:
        'can you check the latest models like href hrrr rap nam and come up with your own prediction',
      workflow: 'short-range-model',
      timeHorizonHours: 6,
      shortRangeGuidance: {
        sourceId: 'href',
        sourceName: 'Short-range guidance blend',
        retrievedAt: '2026-03-25T18:00:00Z',
        validAt: '2026-03-25T18:00:00Z',
        location: {
          query: 'Yorkville, IL',
          name: 'Yorkville, Illinois, United States',
          latitude: 41.64,
          longitude: -88.45,
          resolvedBy: 'open-meteo-geocoding',
        },
        units: {
          defaultUnit: 'model-guidance',
        },
        confidence: 0.72,
        summary:
          'Short-range guidance source context is available for Yorkville, Illinois, United States from HREF, HRRR, RAP, NAM, National Blend of Models, RTMA, and URMA.',
        normalizedForecast: {
          domain: 'short-range-guidance',
          headline:
            'For the next 0 to 48 hours around Yorkville, Illinois, United States, lean on HREF probabilities and RTMA/URMA analysis first, then use HRRR, RAP, and NAM family guidance for timing details.',
          mostLikelyScenario:
            'The most stable short-range call should come from an observation-calibrated blend: HREF for spread, HRRR and RAP for timing, NAM family for structure, and NBM/RTMA/URMA for baseline placement.',
          alternateScenarios: [],
          confidence: 'medium',
          likelihood: 'medium',
          keySignals: [],
          conflicts: [],
          whatWouldChange: [],
          productCards: [],
          recommendedProductIds: [],
        },
        data: {
          products: [],
          notes: [],
          missingSources: [],
        },
        citations: [],
      } as any,
      radarSatelliteNowcast: {
        sourceId: 'mrms',
        sourceName: 'Radar, satellite, and nowcast context',
        retrievedAt: '2026-03-25T18:00:00Z',
        validAt: '2026-03-25T18:00:00Z',
        location: {
          query: 'Yorkville, IL',
          name: 'Yorkville, Illinois, United States',
          latitude: 41.64,
          longitude: -88.45,
          resolvedBy: 'open-meteo-geocoding',
        },
        units: {
          defaultUnit: 'imagery-analysis',
        },
        confidence: 0.58,
        summary:
          'MRMS context is available for Yorkville, Illinois, United States and supports near-real-time radar composite and precipitation analysis.',
        normalizedForecast: {
          domain: 'radar-satellite-nowcast',
          headline:
            'For the current and near-term call around Yorkville, Illinois, United States, MRMS is the only live nowcast source currently available, so confidence is lower than ideal.',
          mostLikelyScenario:
            'MRMS context is available for Yorkville, Illinois, United States, but the full radar, satellite, and MRMS blend is incomplete right now.',
          alternateScenarios: [],
          confidence: 'low',
          likelihood: 'low',
          keySignals: [],
          conflicts: ['Missing source coverage: NEXRAD, GOES.'],
          whatWouldChange: [],
          productCards: [],
          recommendedProductIds: [],
        },
        data: {
          products: [],
          notes: [],
          availableSources: ['mrms'],
          missingSources: ['NEXRAD', 'GOES'],
        },
        citations: [],
      } as any,
    })

    expect(result.bottomLine).toContain(
      'lean on HREF probabilities and RTMA/URMA analysis first',
    )
    expect(result.bottomLine).not.toContain('MRMS is the only live nowcast source')
    expect(result.mostLikelyScenario).toContain(
      'The most stable short-range call should come from an observation-calibrated blend',
    )
  })
})
