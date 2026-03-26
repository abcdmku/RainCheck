import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { locationContextSchema, userSettingsSchema } from './chat'
import {
  citationBundleSchema,
  derivationBundleSchema,
  deriveGlobalRequestSchema,
  deriveHydrologyRequestSchema,
  deriveRadarNowcastRequestSchema,
  deriveSatelliteRequestSchema,
  deriveShortRangeRequestSchema,
  normalizedLocationSchema,
  reportOutlineSchema,
  synthesisBundleSchema,
  synthesizeWeatherRequestSchema,
  weatherToolEnvelopeSchema,
} from './weather'

export const weatherArtifactTypeSchema = z.enum([
  'meteogram',
  'research-report',
  'radar-loop',
  'satellite-loop',
  'hydrograph',
  'skewt',
  'rainfall-chart',
  'snowfall-chart',
  'brief-report',
  'single-model-panel',
  'hodograph',
  'time-height-chart',
])

const weatherLocationQueryInputSchema = z.object({
  locationQuery: z.string().trim().min(1),
})

const weatherLocationQueryWindowInputSchema =
  weatherLocationQueryInputSchema.extend({
    timeHorizonHours: z.number().int().min(0).max(720).optional(),
  })

const weatherLocationQueryProductInputSchema =
  weatherLocationQueryWindowInputSchema.extend({
    product: z.string().optional(),
  })

const nationalWeatherLocationQueryInputSchema = z.object({
  locationQuery: z.string().trim().min(1).default('United States'),
})

const nationalWeatherLocationQueryWindowInputSchema =
  nationalWeatherLocationQueryInputSchema.extend({
    timeHorizonHours: z.number().int().min(0).max(720).optional(),
  })

const weatherStationInputSchema = z.object({
  stationId: z.string(),
})

const weatherArtifactRequestInputSchema = z.object({
  artifactType: weatherArtifactTypeSchema,
  locationQuery: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
})

export const resolveLocationToolDef = toolDefinition({
  name: 'resolve_location',
  description:
    'Resolve a place string, address, region, or lat/lon pair into a normalized location object before weather analysis.',
  inputSchema: weatherLocationQueryInputSchema,
  outputSchema: normalizedLocationSchema,
})

export const getCurrentConditionsToolDef = toolDefinition({
  name: 'get_current_conditions',
  description:
    'Fetch official current conditions and latest observations for a place string, address, region, or lat/lon pair.',
  inputSchema: weatherLocationQueryInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getForecastToolDef = toolDefinition({
  name: 'get_forecast',
  description:
    'Fetch the official short or extended forecast for a place string, address, region, or lat/lon pair.',
  inputSchema: z.object({
    locationQuery: z.string().trim().min(1),
    horizon: z.enum(['short', 'extended']).default('short'),
  }),
  outputSchema: weatherToolEnvelopeSchema,
})

export const getAlertsToolDef = toolDefinition({
  name: 'get_alerts',
  description:
    'Fetch active official weather alerts for a place string, address, region, or lat/lon pair.',
  inputSchema: weatherLocationQueryInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const deriveShortRangeWeatherToolDef = toolDefinition({
  name: 'derive_short_range_weather',
  description:
    'Derive short-range weather evidence from HRRR, RAP, NAM, NAM Nest, HREF, NBM, RTMA, URMA, and supporting official severe context.',
  inputSchema: deriveShortRangeRequestSchema,
  outputSchema: derivationBundleSchema,
})

export const deriveGlobalWeatherToolDef = toolDefinition({
  name: 'derive_global_weather',
  description:
    'Derive global-pattern weather evidence from GFS, GEFS, IFS, AIFS, and supporting medium-range official context.',
  inputSchema: deriveGlobalRequestSchema,
  outputSchema: derivationBundleSchema,
})

export const getSevereContextToolDef = toolDefinition({
  name: 'get_severe_context',
  description:
    'Fetch official SPC severe-weather context including outlooks, watches, mesoscale discussions, and supporting severe-analysis context for a place, region, or national request.',
  inputSchema: nationalWeatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getFireWeatherProductsToolDef = toolDefinition({
  name: 'get_fire_weather_products',
  description: 'Fetch fire-weather outlook context for a place or region.',
  inputSchema: weatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const deriveHydrologyWeatherToolDef = toolDefinition({
  name: 'derive_hydrology_weather',
  description:
    'Derive hydrology and flood evidence using NWPS, NWM, WPC QPF/ERO, and supporting observational context.',
  inputSchema: deriveHydrologyRequestSchema,
  outputSchema: derivationBundleSchema,
})

export const getWpcWinterWeatherToolDef = toolDefinition({
  name: 'get_wpc_winter_weather',
  description:
    'Fetch WPC probabilistic winter weather context for a place or region.',
  inputSchema: weatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getWpcMediumRangeHazardsToolDef = toolDefinition({
  name: 'get_wpc_medium_range_hazards',
  description:
    'Fetch WPC medium-range hazards context for a place, region, or national request. For nationwide questions, use "United States" as locationQuery.',
  inputSchema: nationalWeatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const deriveRadarNowcastToolDef = toolDefinition({
  name: 'derive_radar_nowcast',
  description:
    'Derive storm-scale radar and MRMS evidence for active or near-term weather questions.',
  inputSchema: deriveRadarNowcastRequestSchema,
  outputSchema: derivationBundleSchema,
})

export const deriveSatelliteWeatherToolDef = toolDefinition({
  name: 'derive_satellite_weather',
  description:
    'Derive satellite and lightning evidence using GOES ABI and GLM products.',
  inputSchema: deriveSatelliteRequestSchema,
  outputSchema: derivationBundleSchema,
})

export const getAviationContextToolDef = toolDefinition({
  name: 'get_aviation_context',
  description:
    'Fetch aviation weather context using METAR, TAF, PIREP, SIGMET, G-AIRMET, and related aviation products for a station or nearby airport.',
  inputSchema: weatherStationInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getTropicalWeatherToolDef = toolDefinition({
  name: 'get_tropical_weather',
  description:
    'Fetch tropical weather outlook and advisory context for a basin, storm, or coastal region.',
  inputSchema: weatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getMarineOceanGuidanceToolDef = toolDefinition({
  name: 'get_marine_ocean_guidance',
  description:
    'Fetch marine and ocean guidance for wave, swell, surge, sea-surface temperature, or current questions.',
  inputSchema: weatherLocationQueryProductInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getUpperAirSoundingsToolDef = toolDefinition({
  name: 'get_upper_air_soundings',
  description:
    'Fetch upper-air sounding context for severe-weather setup, teaching, or research.',
  inputSchema: weatherLocationQueryProductInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getHistoricalClimateToolDef = toolDefinition({
  name: 'get_historical_climate',
  description:
    'Fetch historical climate, normals, or anomaly context for a location or station.',
  inputSchema: weatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getStormHistoryToolDef = toolDefinition({
  name: 'get_storm_history',
  description:
    'Fetch historical storm-event context for severe-weather research.',
  inputSchema: weatherLocationQueryProductInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const synthesizeWeatherConclusionToolDef = toolDefinition({
  name: 'synthesize_weather_conclusion',
  description:
    'Synthesize derived weather evidence into one expert judgment with confidence, uncertainty, supporting signals, bust risks, and recommended cards or artifacts.',
  inputSchema: synthesizeWeatherRequestSchema,
  outputSchema: synthesisBundleSchema,
})

export const generateCitationBundleToolDef = toolDefinition({
  name: 'generate_citation_bundle',
  description:
    'Assemble a normalized citation bundle and ranked source manifest from fetched weather products.',
  inputSchema: z.object({
    sourceIds: z.array(z.string()),
    productIds: z.array(z.string()),
  }),
  outputSchema: citationBundleSchema,
})

export const generateReportOutlineToolDef = toolDefinition({
  name: 'generate_report_outline',
  description:
    'Create a deterministic research report outline before generating a weather brief.',
  inputSchema: z.object({
    title: z.string(),
    focus: z.string(),
  }),
  outputSchema: reportOutlineSchema,
})

export const generateWeatherArtifactToolDef = toolDefinition({
  name: 'generate_weather_artifact',
  description:
    'Generate a server-side weather artifact such as a chart, loop, brief, or report for the current thread.',
  inputSchema: weatherArtifactRequestInputSchema,
  outputSchema: z.object({
    artifactId: z.string(),
    title: z.string(),
    href: z.string(),
    mimeType: z.string(),
  }),
})

export const requestGeolocationPermissionToolDef = toolDefinition({
  name: 'request_geolocation_permission',
  description:
    'Ask the browser or device for a current location when a weather request needs a place and the user did not provide one.',
  inputSchema: z.object({}),
  outputSchema: locationContextSchema,
})

export const openArtifactToolDef = toolDefinition({
  name: 'open_artifact_view',
  description: 'Open an artifact in a modal or temporary drawer on the client.',
  inputSchema: z.object({
    artifactId: z.string(),
  }),
  outputSchema: z.object({
    opened: z.boolean(),
  }),
})

export const copyTextToolDef = toolDefinition({
  name: 'copy_to_clipboard',
  description: 'Copy a message or artifact summary to the local clipboard.',
  inputSchema: z.object({
    text: z.string(),
  }),
  outputSchema: z.object({
    copied: z.boolean(),
  }),
})

export const saveUiPreferenceToolDef = toolDefinition({
  name: 'save_ui_preference',
  description: 'Persist a non-sensitive UI preference locally on the client.',
  inputSchema: z.object({
    settings: userSettingsSchema.partial(),
  }),
  outputSchema: z.object({
    saved: z.boolean(),
  }),
})
