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
    ...overrides,
  }
}

describe('buildSystemPrompt', () => {
  it('treats the selected location as the default location query', () => {
    const prompt = buildSystemPrompt(classification(), {
      label: 'Austin, TX',
    })

    expect(prompt).toContain('Default location context: Austin, TX.')
    expect(prompt).toContain('use this exact location as the locationQuery')
    expect(prompt).toContain('Weather tools resolve location internally.')
  })

  it('prefers stored coordinates when they are already available', () => {
    const prompt = buildSystemPrompt(classification(), {
      label: 'Yorkville, IL',
      latitude: 41.64,
      longitude: -88.45,
    })

    expect(prompt).toContain(
      'Default weather tool locationQuery: 41.6400, -88.4500.',
    )
    expect(prompt).toContain(
      'Do not call request_geolocation_permission when the default location context already provides coordinates.',
    )
  })

  it('falls back to device location or a follow-up question when no place is available', () => {
    const prompt = buildSystemPrompt(classification())

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
    )

    expect(prompt).not.toContain('request_geolocation_permission')
    expect(prompt).toContain('Current workflow: weather-analysis.')
  })

  it('treats region names as explicit location context and avoids city substitution', () => {
    const prompt = buildSystemPrompt(
      classification({
        intent: 'severe-weather',
      }),
    )

    expect(prompt).toContain(
      'If the user already named a place or region, including broad regional phrases like central Illinois or northern Indiana, treat that as explicit location context and do not request device geolocation.',
    )
    expect(prompt).toContain(
      'Do not silently replace it with a representative city',
    )
    expect(prompt).toContain(
      'Before the final answer for this workflow, call synthesize_weather_conclusion',
    )
  })

  it('adds capability-aware visual guidance when the user asks for a supported visual', () => {
    const prompt = buildSystemPrompt(
      classification({
        intent: 'severe-weather',
        taskClass: 'research',
        needsArtifact: true,
      }),
    )

    expect(prompt).toContain(
      'Do not provide a chase route, exact intercept point, or go-here-at-this-time severe-weather itinerary.',
    )
    expect(prompt).toContain(
      'Prefer a single official map, radar loop, satellite loop, or brief artifact',
    )
    expect(prompt).toContain(
      'use the closest supported official visual instead',
    )
  })
})
