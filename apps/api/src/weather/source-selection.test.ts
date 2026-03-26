import { describe, expect, it } from 'vitest'

import { chooseSourceManifests } from './source-selection'

describe('chooseSourceManifests', () => {
  it('prefers official forecast products for current weather', () => {
    const sources = chooseSourceManifests({
      taskClass: 'chat',
      intent: 'current-conditions',
      timeHorizonHours: 6,
      locationRequired: true,
      needsArtifact: false,
      chaseGuidanceLevel: 'analysis-only',
    })

    expect(sources[0]?.sourceId).toBe('weather-gov')
    expect(sources.map((source) => source.sourceId)).toContain(
      'open-meteo-geocoding',
    )
  })

  it('routes hydrology manifests through NWPS first', () => {
    const sources = chooseSourceManifests({
      taskClass: 'research',
      intent: 'hydrology',
      timeHorizonHours: 48,
      locationRequired: true,
      needsArtifact: true,
      chaseGuidanceLevel: 'analysis-only',
    })

    expect(sources[0]?.sourceId).toBe('nwps')
    expect(sources.some((source) => source.sourceId === 'mrms')).toBe(true)
    expect(sources.some((source) => source.sourceId === 'wpc')).toBe(true)
  })

  it('routes tropical manifests through NHC', () => {
    const sources = chooseSourceManifests({
      taskClass: 'chat',
      intent: 'tropical',
      timeHorizonHours: 48,
      locationRequired: true,
      needsArtifact: false,
      chaseGuidanceLevel: 'analysis-only',
    })

    expect(sources[0]?.sourceId).toBe('nhc')
    expect(sources.some((source) => source.sourceId === 'weather-gov')).toBe(
      true,
    )
  })

  it('includes global guidance families for medium-range workflows', () => {
    const sources = chooseSourceManifests({
      taskClass: 'research',
      intent: 'global-model',
      timeHorizonHours: 48,
      locationRequired: true,
      needsArtifact: false,
      chaseGuidanceLevel: 'analysis-only',
    })

    expect(sources[0]?.sourceId).toBe('wpc-medium')
    expect(sources.some((source) => source.sourceId === 'gfs')).toBe(true)
    expect(sources.some((source) => source.sourceId === 'gefs')).toBe(true)
    expect(
      sources.some((source) => source.sourceId === 'ecmwf-open-data'),
    ).toBe(true)
  })
})
