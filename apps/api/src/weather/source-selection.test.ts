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
    })

    expect(sources[0]?.sourceId).toBe('weather-gov')
  })

  it('selects radar and severe-weather families for radar analysis', () => {
    const sources = chooseSourceManifests({
      taskClass: 'research',
      intent: 'radar-analysis',
      timeHorizonHours: 6,
      locationRequired: true,
      needsArtifact: true,
    })

    expect(sources.some((source) => source.sourceId === 'nexrad')).toBe(true)
    expect(sources.some((source) => source.sourceId === 'spc')).toBe(true)
  })

  it('selects compact model guidance for model comparison', () => {
    const sources = chooseSourceManifests({
      taskClass: 'research',
      intent: 'model-comparison',
      timeHorizonHours: 48,
      locationRequired: true,
      needsArtifact: true,
    })

    expect(sources.map((source) => source.sourceId)).toContain('gfs')
    expect(sources.map((source) => source.sourceId)).toContain('gefs')
    expect(sources[0]?.sourceId).toBe('weather-gov')
  })

  it('selects hydrology context for flooding questions', () => {
    const sources = chooseSourceManifests({
      taskClass: 'research',
      intent: 'hydrology',
      timeHorizonHours: 48,
      locationRequired: true,
      needsArtifact: true,
    })

    expect(sources.map((source) => source.sourceId)).toContain('nwps')
    expect(sources.map((source) => source.sourceId)).toContain('wpc')
  })
})
