import { describe, expect, it } from 'vitest'

import { requestClassificationSchema } from './chat'
import {
  getAviationContextToolDef,
  getForecastToolDef,
  getGlobalGuidanceToolDef,
  getSevereContextToolDef,
  getShortRangeGuidanceToolDef,
  generateWeatherArtifactToolDef,
  weatherArtifactTypeSchema,
} from './tools'
import { weatherToolEnvelopeSchema } from './weather'
import { weatherSourceCatalog } from './catalog'

describe('weather contracts', () => {
  it('accepts the expanded weather workflow intents', () => {
    expect(
      requestClassificationSchema.parse({
        taskClass: 'chat',
        intent: 'tropical',
        timeHorizonHours: 24,
        locationRequired: true,
        needsArtifact: false,
      }),
    ).toMatchObject({
      intent: 'tropical',
    })

    expect(
      requestClassificationSchema.parse({
        taskClass: 'research',
        intent: 'weather-analysis',
        timeHorizonHours: 48,
        locationRequired: false,
        needsArtifact: false,
      }),
    ).toMatchObject({
      intent: 'weather-analysis',
    })
  })

  it('exposes the streamlined weather tool names', () => {
    expect(getForecastToolDef.name).toBe('get_forecast')
    expect(getAviationContextToolDef.name).toBe('get_aviation_context')
    expect(getSevereContextToolDef.name).toBe('get_severe_context')
    expect(getShortRangeGuidanceToolDef.name).toBe('get_short_range_guidance')
    expect(getGlobalGuidanceToolDef.name).toBe('get_global_guidance')
    expect(generateWeatherArtifactToolDef.name).toBe(
      'generate_weather_artifact',
    )
    expect(weatherArtifactTypeSchema.options).toContain('radar-loop')
    expect(weatherArtifactTypeSchema.options).not.toContain(
      'model-comparison-panel',
    )
  })

  it('defaults national-capable tools to a United States location query', () => {
    expect(getSevereContextToolDef.inputSchema!.parse({})).toMatchObject({
      locationQuery: 'United States',
    })
  })

  it('requires a valid weather envelope time window', () => {
    expect(
      weatherToolEnvelopeSchema.safeParse({
        sourceId: 'wpc',
        sourceName: 'Weather Prediction Center',
        retrievedAt: '2026-03-24T15:00:00Z',
        validAt: '2026-03-24T18:00:00Z',
        location: {
          query: 'Austin, TX',
          name: 'Austin, TX',
          latitude: 30.2672,
          longitude: -97.7431,
          resolvedBy: 'us-census-geocoder',
        },
        units: {
          precipitation: 'in',
        },
        confidence: 0.9,
        summary: 'Rainfall potential is elevated.',
        normalizedForecast: {
          domain: 'precip-flood-context',
          headline: 'Rainfall potential is elevated.',
          alternateScenarios: [],
          keySignals: [],
          conflicts: [],
          failureModes: [],
          whatWouldChange: [],
          productCards: [],
          recommendedProductIds: [],
        },
        data: {
          qpf: 1.2,
        },
        citations: [],
      }).success,
    ).toBe(true)

    expect(
      weatherToolEnvelopeSchema.safeParse({
        sourceId: 'wpc',
        sourceName: 'Weather Prediction Center',
        retrievedAt: '2026-03-24T15:00:00Z',
        location: {
          query: 'Austin, TX',
          name: 'Austin, TX',
          latitude: 30.2672,
          longitude: -97.7431,
          resolvedBy: 'us-census-geocoder',
        },
        units: {},
        confidence: 0.5,
        summary: 'Missing validity window.',
        normalizedForecast: {
          domain: 'forecast',
          headline: 'Missing validity window.',
          alternateScenarios: [],
          keySignals: [],
          conflicts: [],
          failureModes: [],
          whatWouldChange: [],
          productCards: [],
          recommendedProductIds: [],
        },
        data: {},
        citations: [],
      }).success,
    ).toBe(false)
  })

  it('includes the missing public weather families in the catalog', () => {
    const sourceIds = new Set(
      weatherSourceCatalog.map((entry) => entry.sourceId),
    )

    expect(sourceIds.has('spc-fire')).toBe(true)
    expect(sourceIds.has('wpc-winter')).toBe(true)
    expect(sourceIds.has('wpc-medium')).toBe(true)
    expect(sourceIds.has('rap')).toBe(true)
    expect(sourceIds.has('nam')).toBe(true)
    expect(sourceIds.has('href')).toBe(true)
    expect(sourceIds.has('nbm')).toBe(true)
    expect(sourceIds.has('rtma')).toBe(true)
    expect(sourceIds.has('urma')).toBe(true)
    expect(sourceIds.has('nhc')).toBe(true)
    expect(sourceIds.has('wavewatch3')).toBe(true)
    expect(sourceIds.has('rtofs')).toBe(true)
    expect(sourceIds.has('upper-air')).toBe(true)
    expect(sourceIds.has('ncei-cdo')).toBe(true)
    expect(sourceIds.has('ncei-storm-events')).toBe(true)
  })
})
