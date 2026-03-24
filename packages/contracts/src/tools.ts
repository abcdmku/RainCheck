import { toolDefinition } from '@tanstack/ai'
import { z } from 'zod'

import { locationContextSchema, userSettingsSchema } from './chat'
import {
  alertSummarySchema,
  aviationSummarySchema,
  citationBundleSchema,
  currentConditionsSchema,
  forecastSummarySchema,
  hydrologySummarySchema,
  normalizedLocationSchema,
  reportOutlineSchema,
  severeSummarySchema,
} from './weather'

export const resolveLocationToolDef = toolDefinition({
  name: 'resolve_location',
  description:
    'Normalize a place, address-like query, or lat/lon pair into a canonical weather location.',
  inputSchema: z.object({
    query: z.string(),
  }),
  outputSchema: normalizedLocationSchema,
})

export const getCurrentConditionsToolDef = toolDefinition({
  name: 'get_current_conditions',
  description:
    'Fetch official current conditions and latest observations for a normalized location.',
  inputSchema: z.object({
    locationQuery: z.string(),
  }),
  outputSchema: currentConditionsSchema,
})

export const getForecastToolDef = toolDefinition({
  name: 'get_forecast_summary',
  description:
    'Fetch the official short or extended forecast for a normalized location.',
  inputSchema: z.object({
    locationQuery: z.string(),
    horizon: z.enum(['short', 'extended']).default('short'),
  }),
  outputSchema: forecastSummarySchema,
})

export const getAlertsToolDef = toolDefinition({
  name: 'get_alerts',
  description:
    'Fetch active official weather alerts for a normalized location.',
  inputSchema: z.object({
    locationQuery: z.string(),
  }),
  outputSchema: z.array(alertSummarySchema),
})

export const getAviationSummaryToolDef = toolDefinition({
  name: 'get_aviation_summary',
  description:
    'Fetch aviation weather context using METAR and TAF products for a station or nearby airport.',
  inputSchema: z.object({
    stationId: z.string(),
  }),
  outputSchema: aviationSummarySchema,
})

export const getSevereSummaryToolDef = toolDefinition({
  name: 'get_severe_summary',
  description:
    'Fetch severe-weather outlook and watch context for a place or region.',
  inputSchema: z.object({
    locationQuery: z.string(),
  }),
  outputSchema: severeSummarySchema,
})

export const getHydrologySummaryToolDef = toolDefinition({
  name: 'get_hydrology_summary',
  description: 'Fetch hydrology and river-stage context for a place or gauge.',
  inputSchema: z.object({
    locationQuery: z.string(),
  }),
  outputSchema: hydrologySummarySchema,
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

export const generateArtifactToolDef = toolDefinition({
  name: 'generate_artifact',
  description:
    'Generate a server-side weather artifact such as a chart or report for the current thread.',
  inputSchema: z.object({
    artifactType: z.enum(['meteogram', 'research-report']),
    locationQuery: z.string(),
    prompt: z.string(),
  }),
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
    'Ask the browser or device for a current location to use in the thread.',
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
