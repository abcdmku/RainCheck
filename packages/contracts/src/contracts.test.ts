import { describe, expect, it } from 'vitest'

import { citationSchema, requestClassificationSchema } from './chat'
import {
  deriveGlobalWeatherToolDef,
  deriveHydrologyWeatherToolDef,
  deriveRadarNowcastToolDef,
  deriveSatelliteWeatherToolDef,
  deriveShortRangeWeatherToolDef,
  getAviationContextToolDef,
  getForecastToolDef,
  getSevereContextToolDef,
  generateWeatherArtifactToolDef,
  synthesizeWeatherConclusionToolDef,
  weatherArtifactTypeSchema,
} from './tools'
import {
  derivationBundleSchema,
  synthesizeWeatherRequestSchema,
  weatherToolEnvelopeSchema,
} from './weather'
import { weatherSourceCatalog } from './catalog'

describe('weather contracts', () => {
  it('accepts displayUrl on citations and provenance payloads', () => {
    expect(
      citationSchema.parse({
        id: 'nexrad:nexrad-loop',
        label: 'NEXRAD loop',
        sourceId: 'nexrad',
        productId: 'nexrad-loop',
        kind: 'image',
        url: 'https://radar.weather.gov/ridge/standard/CONUS_loop.gif',
        displayUrl: 'https://radar.weather.gov/ridge/standard/CONUS_0.gif',
      }),
    ).toMatchObject({
      displayUrl: 'https://radar.weather.gov/ridge/standard/CONUS_0.gif',
    })
  })

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
      chaseGuidanceLevel: 'analysis-only',
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
      chaseGuidanceLevel: 'analysis-only',
    })
  })

  it('tracks chase guidance specificity in classification payloads', () => {
    expect(
      requestClassificationSchema.parse({
        taskClass: 'research',
        intent: 'severe-weather',
        timeHorizonHours: 6,
        locationRequired: true,
        needsArtifact: false,
        chaseGuidanceLevel: 'general-target',
      }),
    ).toMatchObject({
      chaseGuidanceLevel: 'general-target',
    })
  })

  it('exposes the derivation-oriented weather tool names', () => {
    expect(getForecastToolDef.name).toBe('get_forecast')
    expect(getAviationContextToolDef.name).toBe('get_aviation_context')
    expect(getSevereContextToolDef.name).toBe('get_severe_context')
    expect(deriveShortRangeWeatherToolDef.name).toBe(
      'derive_short_range_weather',
    )
    expect(deriveGlobalWeatherToolDef.name).toBe('derive_global_weather')
    expect(deriveRadarNowcastToolDef.name).toBe('derive_radar_nowcast')
    expect(deriveSatelliteWeatherToolDef.name).toBe(
      'derive_satellite_weather',
    )
    expect(deriveHydrologyWeatherToolDef.name).toBe(
      'derive_hydrology_weather',
    )
    expect(synthesizeWeatherConclusionToolDef.name).toBe(
      'synthesize_weather_conclusion',
    )
    expect(generateWeatherArtifactToolDef.name).toBe(
      'generate_weather_artifact',
    )
    expect(weatherArtifactTypeSchema.options).toContain('radar-loop')
    expect(weatherArtifactTypeSchema.options).toContain('hodograph')
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

  it('accepts collection-based synthesis input for derived evidence', () => {
    expect(
      synthesizeWeatherRequestSchema.safeParse({
        userQuestion: 'What is the most likely storm mode by 00z?',
        workflow: 'severe-weather',
        region: {
          type: 'point',
          location: {
            query: 'Norman, OK',
            name: 'Norman, OK',
            latitude: 35.22,
            longitude: -97.44,
            resolvedBy: 'us-census-geocoder',
          },
          radiusKm: 80,
        },
        timeWindow: {
          start: '2026-03-24T18:00:00Z',
          end: '2026-03-25T00:00:00Z',
        },
        chaseGuidanceLevel: 'exact-target',
        evidenceProducts: [
          {
            id: 'href-stp',
            sourceFamily: 'short-range-guidance',
            sourceName: 'HREF',
            validTime: '2026-03-24T23:00:00Z',
            geometry: {
              type: 'bbox',
              west: -100,
              south: 34,
              east: -96,
              north: 37,
            },
            fieldName: 'effective_stp',
            fieldType: 'derived_diagnostic',
            units: 'index',
            summary: 'Ensemble tornado-supportive corridor remains focused along the dryline.',
            signalScore: 0.76,
            confidence: 0.7,
            provenance: [
              {
                sourceId: 'href',
                productId: 'stp',
                label: 'HREF STP field',
              kind: 'dataset',
              url: 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/href/prod/href.20260324/ensprod/href.t18z.conus.avrg.f05.grib2',
              contextUrl: 'https://mag.ncep.noaa.gov/data/href/18/example.gif',
              displayUrl: 'https://mag.ncep.noaa.gov/data/href/18/example.gif',
              retrievedAt: '2026-03-24T18:05:00Z',
            },
          ],
            artifactHandles: [],
          },
        ],
        supportingBundles: [],
      }).success,
    ).toBe(true)
  })

  it('accepts derivation bundles with evidence products', () => {
    expect(
      derivationBundleSchema.safeParse({
        workflow: 'short-range-model',
        region: {
          type: 'point',
          location: {
            query: 'Norman, OK',
            name: 'Norman, OK',
            latitude: 35.22,
            longitude: -97.44,
            resolvedBy: 'us-census-geocoder',
          },
          radiusKm: 80,
        },
        analysisWindow: {
          start: '2026-03-24T18:00:00Z',
          end: '2026-03-25T00:00:00Z',
        },
        evidenceProducts: [],
        agreementSummary: 'Short-range guidance favors a discrete initiation corridor before upscale growth.',
        keyConflicts: [],
        recommendedCards: [],
        recommendedArtifacts: [],
        sourcesUsed: ['href', 'hrrr'],
        sourcesMissing: [],
      }).success,
    ).toBe(true)
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
