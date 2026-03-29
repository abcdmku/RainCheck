import type { RequestClassification } from '@raincheck/contracts'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { geocodeQueryMock } = vi.hoisted(() => ({
  geocodeQueryMock: vi.fn(),
}))

vi.mock('./geocode', () => ({
  geocodeQuery: geocodeQueryMock,
}))

import { buildComparisonLimitationContext } from './comparison'

function classification(): RequestClassification {
  return {
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
  }
}

describe('buildComparisonLimitationContext', () => {
  afterEach(() => {
    geocodeQueryMock.mockReset()
  })

  it('does not treat a saved location as implicit beach discovery scope', async () => {
    const app = {} as any

    const result = await buildComparisonLimitationContext({
      app,
      classification: classification(),
      userQuestion: 'best area for beaches and when',
      context: {
        answerTone: 'casual',
        timeDisplay: 'user-local',
        locationHint: {
          label: 'Chicago, IL',
          latitude: 41.8781,
          longitude: -87.6298,
          timezone: 'America/Chicago',
        },
      },
    })

    expect(geocodeQueryMock).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      workflow: 'forecast',
      answerMode: 'rank',
      candidateMode: 'discovered',
      rankingObjective: 'beach-day',
    })
    expect(result?.discoveryScope).toBeUndefined()
  })

  it('treats a bare-city beach follow-up as an explicit discovery region', async () => {
    const app = {} as any
    geocodeQueryMock.mockResolvedValue({
      query: 'chicago',
      name: 'Chicago, Illinois, United States',
      latitude: 41.8781,
      longitude: -87.6298,
      region: 'Illinois',
      country: 'United States',
      timezone: 'America/Chicago',
      resolvedBy: 'open-meteo-geocoding',
    })

    const result = await buildComparisonLimitationContext({
      app,
      classification: classification(),
      userQuestion: 'chicago',
      context: {
        answerTone: 'casual',
        timeDisplay: 'user-local',
        locationHint: {
          label: 'Austin, TX',
          latitude: 30.2672,
          longitude: -97.7431,
          timezone: 'America/Chicago',
        },
      },
      messages: [
        {
          role: 'assistant',
          parts: [
            {
              type: 'weather-comparison-context',
              context: {
                workflow: 'forecast',
                answerMode: 'rank',
                candidateMode: 'discovered',
                rankLimit: 5,
                rankingObjective: 'beach-day',
                candidates: [],
              },
            },
          ],
        },
      ],
    })

    expect(geocodeQueryMock).toHaveBeenCalledWith(app, 'chicago')
    expect(result?.discoveryScope).toMatchObject({
      category: 'beach',
      locationQuery: 'chicago',
      location: {
        name: 'Chicago, Illinois, United States',
      },
    })
  })
})
