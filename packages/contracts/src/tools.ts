import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { locationContextSchema, userSettingsSchema } from './chat'
import {
  citationBundleSchema,
  hydrologySummarySchema,
  modelComparisonEntrySchema,
  modelComparisonSummarySchema,
  normalizedLocationSchema,
  reportOutlineSchema,
  severeSummarySchema,
  weatherToolEnvelopeSchema,
} from './weather'

export const weatherArtifactTypeSchema = z.enum([
  'meteogram',
  'research-report',
  'radar-loop',
  'satellite-loop',
  'model-comparison-panel',
  'hydrograph',
  'skewt',
  'rainfall-chart',
  'snowfall-chart',
  'brief-report',
])

const weatherLocationQueryInputSchema = z.object({
  locationQuery: z.string(),
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
  locationQuery: z.string().default('United States'),
})

const nationalWeatherLocationQueryWindowInputSchema =
  nationalWeatherLocationQueryInputSchema.extend({
    timeHorizonHours: z.number().int().min(0).max(720).optional(),
  })

const nationalWeatherLocationQueryProductInputSchema =
  nationalWeatherLocationQueryWindowInputSchema.extend({
    product: z.string().optional(),
  })

const weatherStationInputSchema = z.object({
  stationId: z.string(),
})

const compareModelsInputSchema = z.object({
  locationName: z.string(),
  comparedModels: z.array(modelComparisonEntrySchema).min(2),
})

const weatherArtifactRequestInputSchema = z.object({
  artifactType: weatherArtifactTypeSchema,
  locationQuery: z.string(),
  prompt: z.string(),
})

// Always-on core tools.
export const resolveLocationToolDef = toolDefinition({
  name: 'resolve_location',
  description:
    'Normalize only a place string, address-like query, or lat/lon pair into a canonical weather location. Do not pass the entire weather question.',
  inputSchema: z.object({
    query: z.string(),
  }),
  outputSchema: normalizedLocationSchema,
})

export const getCurrentConditionsToolDef = toolDefinition({
  name: 'get_current_conditions',
  description:
    'Fetch official current conditions and latest observations for a normalized location.',
  inputSchema: weatherLocationQueryInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getForecastToolDef = toolDefinition({
  name: 'get_forecast',
  description:
    'Fetch the official short or extended forecast for a normalized location.',
  inputSchema: z.object({
    locationQuery: z.string(),
    horizon: z.enum(['short', 'extended']).default('short'),
  }),
  outputSchema: weatherToolEnvelopeSchema,
})

export const getAlertsToolDef = toolDefinition({
  name: 'get_alerts',
  description:
    'Fetch active official weather alerts for a normalized location.',
  inputSchema: weatherLocationQueryInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getAviationWeatherToolDef = toolDefinition({
  name: 'get_aviation_weather',
  description:
    'Fetch aviation weather context using METAR, TAF, and other aviation products for a station or nearby airport.',
  inputSchema: weatherStationInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getAviationSummaryToolDef = getAviationWeatherToolDef

export const getSpcSevereProductsToolDef = toolDefinition({
  name: 'get_spc_severe_products',
  description:
    'Fetch official SPC severe-weather outlook, watch, mesoanalysis, and mesoscale discussion context for a place, region, or national request. For nationwide questions, use "United States" as locationQuery.',
  inputSchema: nationalWeatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getSevereSummaryToolDef = toolDefinition({
  name: 'get_severe_summary',
  description:
    'Fetch severe-weather outlook and watch context for a place or region.',
  inputSchema: weatherLocationQueryInputSchema,
  outputSchema: severeSummarySchema,
})

export const getFireWeatherProductsToolDef = toolDefinition({
  name: 'get_fire_weather_products',
  description: 'Fetch fire-weather outlook context for a place or region.',
  inputSchema: weatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getWpcQpfEroToolDef = toolDefinition({
  name: 'get_wpc_qpf_ero',
  description:
    'Fetch WPC quantitative precipitation forecast and excessive rainfall outlook context for a place or region.',
  inputSchema: weatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
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

export const getHydrologyNwpsToolDef = toolDefinition({
  name: 'get_hydrology_nwps',
  description:
    'Fetch NWPS hydrology and river-stage context for a place or gauge.',
  inputSchema: weatherLocationQueryWindowInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getHydrologySummaryToolDef = toolDefinition({
  name: 'get_hydrology_summary',
  description: 'Fetch hydrology and river-stage context for a place or gauge.',
  inputSchema: weatherLocationQueryInputSchema,
  outputSchema: hydrologySummarySchema,
})

export const getNexradRadarToolDef = toolDefinition({
  name: 'get_nexrad_radar',
  description:
    'Fetch NEXRAD radar context and loop-ready frame handles for active storms.',
  inputSchema: weatherLocationQueryProductInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getGoesSatelliteToolDef = toolDefinition({
  name: 'get_goes_satellite',
  description:
    'Fetch GOES satellite context and loop-ready frame handles for cloud, water vapor, smoke, fog, or lightning analysis.',
  inputSchema: weatherLocationQueryProductInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getMrmsProductsToolDef = toolDefinition({
  name: 'get_mrms_products',
  description:
    'Fetch MRMS precipitation-rate, QPE, and composite analysis products.',
  inputSchema: weatherLocationQueryProductInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getShortRangeModelGuidanceToolDef = toolDefinition({
  name: 'get_short_range_model_guidance',
  description:
    'Fetch high-level short-range model guidance context and source links for HRRR, RAP, NAM, and HREF. This tool does not return field-specific HRRR parameters like tornado probability, supercell composite, STP, or convective wording.',
  inputSchema: weatherLocationQueryProductInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getBlendAndAnalysisGuidanceToolDef = toolDefinition({
  name: 'get_blend_and_analysis_guidance',
  description:
    'Fetch blend and analysis guidance for near-term surface forecast calibration.',
  inputSchema: weatherLocationQueryProductInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const getGlobalModelGuidanceToolDef = toolDefinition({
  name: 'get_global_model_guidance',
  description:
    'Fetch global model guidance for 2 to 10 day synoptic pattern questions for a place, region, or the nation. For nationwide questions, use "United States" as locationQuery.',
  inputSchema: nationalWeatherLocationQueryProductInputSchema,
  outputSchema: weatherToolEnvelopeSchema,
})

export const compareModelsToolDef = toolDefinition({
  name: 'compare_models',
  description:
    'Normalize and compare at least two weather model guidance results into one object for synthesis.',
  inputSchema: compareModelsInputSchema,
  outputSchema: modelComparisonSummarySchema,
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

export const generateArtifactToolDef = generateWeatherArtifactToolDef

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
