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
    expect(prompt).toContain(
      'Never pass the entire user request into resolve_location.',
    )
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
      'Do not call request_geolocation_permission or resolve_location when the default location context already provides coordinates.',
    )
  })

  it('falls back to device location or a follow-up question when no place is available', () => {
    const prompt = buildSystemPrompt(classification())

    expect(prompt).toContain('first use request_geolocation_permission')
    expect(prompt).toContain(
      'ask the user for a city, address, or coordinates before fetching weather',
    )
    expect(prompt).toContain(
      'Never pass the entire user request into resolve_location.',
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
})
