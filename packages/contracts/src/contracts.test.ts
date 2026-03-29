import { describe, expect, it } from 'vitest'
import { runtimeInfoResponseSchema } from './api'
import { weatherSourceCatalog } from './catalog'
import { citationSchema, requestClassificationSchema } from './chat'
import { appSettingsSchema } from './settings'
import {
  compareWeatherCandidatesToolDef,
  deriveGlobalWeatherToolDef,
  deriveHydrologyWeatherToolDef,
  deriveRadarNowcastToolDef,
  deriveSatelliteWeatherToolDef,
  deriveShortRangeWeatherToolDef,
  generateWeatherArtifactToolDef,
  getAviationContextToolDef,
  getForecastToolDef,
  getSevereContextToolDef,
  synthesizeWeatherConclusionToolDef,
  weatherArtifactTypeSchema,
} from './tools'
import {
  derivationBundleSchema,
  synthesizeWeatherRequestSchema,
  weatherComparisonBundleSchema,
  weatherComparisonRequestSchema,
  weatherToolEnvelopeSchema,
} from './weather'

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
        answerMode: 'compare',
        candidateMode: 'named',
        rankLimit: 2,
        rankingObjective: 'severe-favorability',
      }),
    ).toMatchObject({
      chaseGuidanceLevel: 'general-target',
      answerMode: 'compare',
      candidateMode: 'named',
      rankLimit: 2,
      rankingObjective: 'severe-favorability',
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
    expect(deriveSatelliteWeatherToolDef.name).toBe('derive_satellite_weather')
    expect(deriveHydrologyWeatherToolDef.name).toBe('derive_hydrology_weather')
    expect(synthesizeWeatherConclusionToolDef.name).toBe(
      'synthesize_weather_conclusion',
    )
    expect(compareWeatherCandidatesToolDef.name).toBe(
      'compare_weather_candidates',
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
    expect(getSevereContextToolDef.inputSchema?.parse({})).toMatchObject({
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
        originLocation: {
          query: 'Chicago, IL',
          name: 'Chicago, Illinois, United States',
          latitude: 41.8781,
          longitude: -87.6298,
          region: 'Illinois',
          country: 'United States',
          timezone: 'America/Chicago',
          resolvedBy: 'open-meteo-geocoding',
        },
        displayTimezone: 'America/Chicago',
        answerTone: 'professional',
        timeDisplay: 'user-local',
        selectedTarget: {
          query: 'Springfield, Illinois',
          label: 'Springfield to Bloomington-Normal in central Illinois',
          location: {
            query: 'Springfield, Illinois',
            name: 'Springfield, Illinois, United States',
            latitude: 39.7817,
            longitude: -89.6501,
            region: 'Illinois',
            country: 'United States',
            timezone: 'America/Chicago',
            resolvedBy: 'raincheck-regional-anchor',
          },
          regionLabel: 'central Illinois',
          startLabel: 'Springfield',
          stopLabel: 'Bloomington-Normal',
          travelHours: 3,
          corridorHours: 1,
          withinNearbyRadius: true,
          supportScore: 0.78,
        },
        nightfall: {
          event: 'civil-dusk',
          occursAt: '2026-03-25T00:18:00Z',
        },
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
            summary:
              'Ensemble tornado-supportive corridor remains focused along the dryline.',
            signalScore: 0.76,
            confidence: 0.7,
            provenance: [
              {
                sourceId: 'href',
                productId: 'stp',
                label: 'HREF STP field',
                kind: 'dataset',
                url: 'https://nomads.ncep.noaa.gov/pub/data/nccf/com/href/prod/href.20260324/ensprod/href.t18z.conus.avrg.f05.grib2',
                contextUrl:
                  'https://mag.ncep.noaa.gov/data/href/18/example.gif',
                displayUrl:
                  'https://mag.ncep.noaa.gov/data/href/18/example.gif',
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

  it('defaults app settings time display to user local', () => {
    expect(
      appSettingsSchema.parse({
        theme: 'dark',
        units: 'imperial',
        defaultLocationLabel: null,
        allowDeviceLocation: false,
        providerPreferences: [],
        shareByDefault: false,
      }),
    ).toMatchObject({
      answerTone: 'casual',
      timeDisplay: 'user-local',
    })
  })

  it('accepts runtime diagnostics payloads', () => {
    expect(
      runtimeInfoResponseSchema.parse({
        runtime: {
          runtimeId: 'api-4242-abcd1234',
          startedAt: '2026-03-26T21:00:00.000Z',
          processId: 4242,
          environment: 'development',
          apiBaseUrl: 'http://localhost:3001',
          weatherServiceUrl: 'http://127.0.0.1:8000',
        },
      }),
    ).toMatchObject({
      runtime: {
        runtimeId: 'api-4242-abcd1234',
        environment: 'development',
      },
    })
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
        agreementSummary:
          'Short-range guidance favors a discrete initiation corridor before upscale growth.',
        keyConflicts: [],
        recommendedCards: [],
        recommendedArtifacts: [],
        sourcesUsed: ['href', 'hrrr'],
        sourcesMissing: [],
      }).success,
    ).toBe(true)
  })

  it('accepts comparison requests and comparison bundles', () => {
    expect(
      weatherComparisonRequestSchema.safeParse({
        userQuestion:
          'Compare Bloomington, IL and Paxton, IL for tornado favorability.',
        workflow: 'severe-weather',
        answerMode: 'compare',
        candidateMode: 'named',
        rankLimit: 2,
        rankingObjective: 'severe-favorability',
        answerTone: 'professional',
        candidates: [
          {
            candidate: {
              query: 'Bloomington, IL',
              label: 'Bloomington, IL',
              location: {
                query: 'Bloomington, IL',
                name: 'Bloomington, Illinois, United States',
                latitude: 40.4842,
                longitude: -88.9937,
                resolvedBy: 'pytest',
              },
              source: 'user',
            },
            severeContext: {
              sourceId: 'spc',
              sourceName: 'Storm Prediction Center',
              retrievedAt: '2026-03-24T15:00:00Z',
              validAt: '2026-03-24T15:00:00Z',
              location: {
                query: 'Bloomington, IL',
                name: 'Bloomington, Illinois, United States',
                latitude: 40.4842,
                longitude: -88.9937,
                resolvedBy: 'pytest',
              },
              units: {},
              confidence: 0.8,
              summary: 'SPC severe context for Bloomington.',
              normalizedForecast: {
                domain: 'severe-context',
                headline: 'Bloomington severe context.',
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
            },
            supportingBundles: [],
          },
        ],
      }).success,
    ).toBe(true)

    expect(
      weatherComparisonBundleSchema.safeParse({
        answerMode: 'compare',
        rankingObjective: 'severe-favorability',
        rankLimit: 2,
        bottomLine:
          'Paxton looks more favorable than Bloomington for severe favorability right now.',
        confidence: {
          level: 'medium',
          reason: 'The leading candidate separates modestly from the rest.',
        },
        whyRainCheckThinksThat:
          'RainCheck weighted storm-scale radar support, short-range severe signal, official severe context, and conflict penalties across each candidate.',
        sharedUncertainty: 'Boundary placement can still shift the corridor.',
        rankedCandidates: [],
        recommendedCards: [],
        citations: [],
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
