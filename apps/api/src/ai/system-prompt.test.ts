import type { RequestClassification } from '@raincheck/contracts'
import { describe, expect, it } from 'vitest'

import { buildSystemPrompt } from './system-prompt'

function classification(
  overrides: Partial<RequestClassification> = {},
): RequestClassification {
  return {
    taskClass: 'chat',
    intent: 'forecast',
    timeHorizonHours: 240,
    locationRequired: true,
    needsArtifact: false,
    chaseGuidanceLevel: 'analysis-only',
    answerMode: 'single',
    candidateMode: 'named',
    rankLimit: 1,
    ...overrides,
  }
}

describe('buildSystemPrompt', () => {
  it('treats the selected location as the default location query', () => {
    const prompt = buildSystemPrompt(classification(), {
      answerTone: 'casual',
      timeDisplay: 'user-local',
      locationHint: {
        label: 'Austin, TX',
      },
    })

    expect(prompt).toContain('Default location context: Austin, TX.')
    expect(prompt).toContain('use this exact location as the locationQuery')
    expect(prompt).toContain('Weather tools resolve location internally.')
  })

  it('prefers stored coordinates when they are already available', () => {
    const prompt = buildSystemPrompt(classification(), {
      answerTone: 'casual',
      timeDisplay: 'user-local',
      locationHint: {
        label: 'Yorkville, IL',
        latitude: 41.64,
        longitude: -88.45,
      },
    })

    expect(prompt).toContain(
      'Default weather tool locationQuery: 41.6400, -88.4500.',
    )
    expect(prompt).toContain(
      'Do not call request_geolocation_permission when the default location context already provides coordinates.',
    )
  })

  it('treats the selected location as travel origin for broad severe storm hunts', () => {
    const prompt = buildSystemPrompt(
      classification({
        intent: 'severe-weather',
        taskClass: 'research',
        locationRequired: false,
        chaseGuidanceLevel: 'general-target',
      }),
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

    expect(prompt).toContain('travel-origin context')
    expect(prompt).toContain(
      'resolve the target to a nearby named city corridor or subnational region',
    )
    expect(prompt).toContain('The user local time zone is America/Chicago.')
    expect(prompt).not.toContain('use this exact location as the locationQuery')
  })

  it('falls back to device location or a follow-up question when no place is available', () => {
    const prompt = buildSystemPrompt(classification(), {
      answerTone: 'casual',
      timeDisplay: 'user-local',
    })

    expect(prompt).toContain('first use request_geolocation_permission')
    expect(prompt).toContain(
      'ask the user for a city, address, or coordinates before fetching weather',
    )
    expect(prompt).toContain(
      'Only pass the place text or coordinates into locationQuery',
    )
  })

  it('does not force device geolocation for broad non-location workflows', () => {
    const prompt = buildSystemPrompt(
      classification({
        intent: 'weather-analysis',
        locationRequired: false,
        taskClass: 'research',
      }),
      {
        answerTone: 'casual',
        timeDisplay: 'user-local',
      },
    )

    expect(prompt).not.toContain('request_geolocation_permission')
    expect(prompt).toContain('Current workflow: weather-analysis.')
  })

  it('keeps non-severe workflows free of chase-specific prompt guidance', () => {
    const prompt = buildSystemPrompt(classification(), {
      answerTone: 'casual',
      timeDisplay: 'user-local',
    })

    expect(prompt).not.toContain('Chase guidance level')
    expect(prompt).not.toContain('For broad severe-weather chase answers')
    expect(prompt).not.toContain('For short-range severe-weather questions')
  })

  it('treats region names as explicit location context and avoids city substitution', () => {
    const prompt = buildSystemPrompt(
      classification({
        intent: 'severe-weather',
      }),
      {
        answerTone: 'casual',
        timeDisplay: 'user-local',
      },
    )

    expect(prompt).toContain(
      'If the user already named a place or region, including broad regional phrases like central Illinois or northern Indiana, treat that as explicit location context and do not request device geolocation.',
    )
    expect(prompt).toContain(
      'Do not silently replace it with a representative city',
    )
    expect(prompt).toContain(
      'prefer the high-level derive tools: derive_short_range_weather, derive_global_weather, derive_radar_nowcast, derive_satellite_weather, and derive_hydrology_weather',
    )
    expect(prompt).toContain(
      'For SPC outlook, convective outlook, or Day 1/2/3/4-8 questions, call get_severe_context first.',
    )
  })

  it('adds capability-aware visual guidance when the user asks for a supported visual', () => {
    const prompt = buildSystemPrompt(
      classification({
        intent: 'severe-weather',
        taskClass: 'research',
        needsArtifact: true,
        chaseGuidanceLevel: 'general-target',
      }),
      {
        answerTone: 'casual',
        timeDisplay: 'user-local',
      },
    )

    expect(prompt).toContain(
      'Chase guidance level for this request: general-target.',
    )
    expect(prompt).toContain(
      'You may give a starting corridor and a start time window for the chase.',
    )
    expect(prompt).toContain(
      'Prefer a single official map, radar loop, satellite loop, or brief artifact',
    )
    expect(prompt).toContain(
      'use the closest supported official visual instead',
    )
  })

  it('asks for an explicit region before discovery rankings even when a saved location exists', () => {
    const prompt = buildSystemPrompt(
      classification({
        intent: 'forecast',
        locationRequired: false,
        answerMode: 'rank',
        candidateMode: 'discovered',
        rankLimit: 5,
        rankingObjective: 'beach-day',
      }),
      {
        answerTone: 'casual',
        timeDisplay: 'user-local',
        locationHint: {
          label: 'Chicago, IL',
          latitude: 41.8781,
          longitude: -87.6298,
        },
      },
    )

    expect(prompt).toContain(
      'only use a saved/default location when the user explicitly asks for nearby or current-area results',
    )
    expect(prompt).toContain('ask for one before comparing candidates')
  })

  it('allows route-level guidance only when the request explicitly asks for it', () => {
    const prompt = buildSystemPrompt(
      classification({
        intent: 'severe-weather',
        taskClass: 'research',
        chaseGuidanceLevel: 'full-route',
      }),
      {
        answerTone: 'casual',
        timeDisplay: 'user-local',
      },
    )

    expect(prompt).toContain(
      'Chase guidance level for this request: full-route.',
    )
    expect(prompt).toContain(
      'route-level directions are allowed when the evidence supports them',
    )
    expect(prompt).toContain(
      'step down to exact-target or general-target guidance instead of refusing',
    )
  })

  it('adds tone guidance for casual and professional answer modes', () => {
    const casualPrompt = buildSystemPrompt(classification(), {
      answerTone: 'casual',
      timeDisplay: 'user-local',
    })
    const professionalPrompt = buildSystemPrompt(classification(), {
      answerTone: 'professional',
      timeDisplay: 'user-local',
    })

    expect(casualPrompt).toContain('Use a casual, plainspoken tone by default.')
    expect(casualPrompt).toContain('Translate jargon like ensemble spread')
    expect(professionalPrompt).toContain(
      'Use a professional meteorologist tone by default.',
    )
    expect(professionalPrompt).toContain(
      'Use concise technical weather language when it improves precision',
    )
  })
})
