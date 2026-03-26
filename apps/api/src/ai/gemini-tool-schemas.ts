import type { JSONSchema, ServerTool } from '@tanstack/ai'

type AnyServerTool = ServerTool<any, any>

const artifactTypes = [
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
] as const

const normalizedLocationInputSchema: JSONSchema = {
  type: 'object',
  description:
    'Resolved point location with a label and coordinates from the location tool.',
  properties: {
    query: { type: 'string' },
    name: { type: 'string' },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    region: { type: 'string' },
    country: { type: 'string' },
    resolvedBy: { type: 'string' },
  },
  required: ['query', 'name', 'latitude', 'longitude', 'resolvedBy'],
}

const regionInputSchema: JSONSchema = {
  type: 'object',
  description:
    'Analysis area. Use type "point" with a resolved location for place-based requests, or type "bbox" for map windows.',
  properties: {
    type: {
      type: 'string',
      enum: ['point', 'bbox'],
    },
    location: normalizedLocationInputSchema,
    radiusKm: {
      type: 'number',
      minimum: 1,
      maximum: 800,
      description: 'Point-radius search distance in kilometers.',
    },
    west: { type: 'number', minimum: -180, maximum: 180 },
    south: { type: 'number', minimum: -90, maximum: 90 },
    east: { type: 'number', minimum: -180, maximum: 180 },
    north: { type: 'number', minimum: -90, maximum: 90 },
    label: { type: 'string' },
  },
  required: ['type'],
}

const timeWindowInputSchema: JSONSchema = {
  type: 'object',
  description: 'Requested analysis window in ISO-8601 time.',
  properties: {
    start: { type: 'string' },
    end: { type: 'string' },
    referenceTime: { type: 'string' },
    recentHours: {
      type: 'number',
      minimum: 0,
      maximum: 72,
    },
  },
  required: ['start', 'end'],
}

const requestedArtifactInputSchema: JSONSchema = {
  type: 'object',
  description:
    'Optional analyst artifact request. Keep these to single-product artifacts only.',
  properties: {
    type: {
      type: 'string',
      enum: [...artifactTypes],
    },
    required: { type: 'boolean' },
    maxFrames: {
      type: 'number',
      minimum: 1,
      maximum: 36,
    },
  },
  required: ['type'],
}

const artifactHandleInputSchema: JSONSchema = {
  type: 'object',
  description: 'Reference to a rendered artifact returned by the weather service.',
  properties: {
    artifactId: { type: 'string' },
    type: {
      type: 'string',
      enum: [...artifactTypes],
    },
    title: { type: 'string' },
    href: { type: 'string' },
    mimeType: { type: 'string' },
  },
  required: ['artifactId', 'type', 'title', 'href', 'mimeType'],
}

const evidenceGeometryInputSchema: JSONSchema = {
  type: 'object',
  description: 'Geometry attached to a normalized evidence product.',
  properties: {
    type: {
      type: 'string',
      enum: ['point', 'bbox'],
    },
    latitude: { type: 'number', minimum: -90, maximum: 90 },
    longitude: { type: 'number', minimum: -180, maximum: 180 },
    west: { type: 'number', minimum: -180, maximum: 180 },
    south: { type: 'number', minimum: -90, maximum: 90 },
    east: { type: 'number', minimum: -180, maximum: 180 },
    north: { type: 'number', minimum: -90, maximum: 90 },
    label: { type: 'string' },
  },
  required: ['type'],
}

const evidenceProvenanceInputSchema: JSONSchema = {
  type: 'object',
  description: 'Source and timing metadata for an evidence product.',
  properties: {
    sourceId: { type: 'string' },
    productId: { type: 'string' },
    label: { type: 'string' },
    url: { type: 'string' },
    retrievedAt: { type: 'string' },
    issuedAt: { type: 'string' },
    validAt: { type: 'string' },
    notes: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['sourceId', 'productId', 'label', 'retrievedAt'],
}

const evidenceProductInputSchema: JSONSchema = {
  type: 'object',
  description:
    'Normalized evidence product returned by a derive endpoint. Pass through the tool output fields directly.',
  properties: {
    id: { type: 'string' },
    sourceFamily: { type: 'string' },
    sourceName: { type: 'string' },
    cycleTime: { type: 'string' },
    validTime: { type: 'string' },
    geometry: evidenceGeometryInputSchema,
    fieldName: { type: 'string' },
    fieldType: {
      type: 'string',
      enum: [
        'raw_field',
        'derived_diagnostic',
        'probability',
        'official_product',
        'observation',
      ],
    },
    level: { type: 'string' },
    units: { type: 'string' },
    spatialResolution: { type: 'string' },
    summary: { type: 'string' },
    summaryStats: {
      type: 'object',
      description: 'Flat summary stats object with simple scalar values.',
    },
    signalScore: { type: 'number', minimum: 0, maximum: 1 },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    provenance: {
      type: 'array',
      items: evidenceProvenanceInputSchema,
    },
    artifactHandles: {
      type: 'array',
      items: artifactHandleInputSchema,
    },
  },
  required: [
    'sourceFamily',
    'sourceName',
    'validTime',
    'geometry',
    'fieldName',
    'fieldType',
    'units',
    'summary',
  ],
}

const derivationBundleInputSchema: JSONSchema = {
  type: 'object',
  description:
    'Normalized derive endpoint output. Pass these objects from derive tool results into synthesis.',
  properties: {
    workflow: { type: 'string' },
    region: regionInputSchema,
    analysisWindow: timeWindowInputSchema,
    evidenceProducts: {
      type: 'array',
      items: evidenceProductInputSchema,
    },
    agreementSummary: { type: 'string' },
    keyConflicts: {
      type: 'array',
      items: { type: 'string' },
    },
    recommendedCards: {
      type: 'array',
      items: {
        type: 'object',
        description: 'Single-product card returned by a derive endpoint.',
      },
    },
    recommendedArtifacts: {
      type: 'array',
      items: artifactHandleInputSchema,
    },
    sourcesUsed: {
      type: 'array',
      items: { type: 'string' },
    },
    sourcesMissing: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: [
    'workflow',
    'region',
    'analysisWindow',
    'evidenceProducts',
    'agreementSummary',
  ],
}

function buildDeriveRequestInputSchema(domains: Array<string>): JSONSchema {
  return {
    type: 'object',
    description:
      'High-level weather derivation request. Resolve the location first, then request the smallest relevant domain and artifact set.',
    properties: {
      userQuestion: { type: 'string' },
      workflow: { type: 'string' },
      region: regionInputSchema,
      timeWindow: timeWindowInputSchema,
      chaseGuidanceLevel: {
        type: 'string',
        enum: ['analysis-only', 'general-target', 'exact-target', 'full-route'],
      },
      domain: {
        type: 'string',
        enum: domains,
      },
      focus: { type: 'string' },
      variables: {
        type: 'array',
        items: { type: 'string' },
      },
      requestedArtifacts: {
        type: 'array',
        items: requestedArtifactInputSchema,
      },
      includeOfficialContext: { type: 'boolean' },
    },
    required: ['userQuestion', 'workflow', 'region', 'timeWindow', 'domain'],
  }
}

const synthesizeWeatherInputSchema: JSONSchema = {
  type: 'object',
  description:
    'Synthesize previously derived evidence into one expert judgment. Pass through the evidenceProducts and supportingBundles from derive tool outputs.',
  properties: {
    userQuestion: { type: 'string' },
    workflow: { type: 'string' },
    region: regionInputSchema,
    timeWindow: timeWindowInputSchema,
    chaseGuidanceLevel: {
      type: 'string',
      enum: ['analysis-only', 'general-target', 'exact-target', 'full-route'],
    },
    evidenceProducts: {
      type: 'array',
      items: evidenceProductInputSchema,
    },
    supportingBundles: {
      type: 'array',
      items: derivationBundleInputSchema,
    },
  },
  required: ['userQuestion', 'workflow', 'region', 'timeWindow'],
}

const geminiInputSchemaByToolName: Record<string, JSONSchema> = {
  derive_short_range_weather: buildDeriveRequestInputSchema([
    'severe',
    'convection',
    'storm-mode',
    'snow',
    'ice',
    'low-clouds',
    'fog',
    'temperature-gradient',
  ]),
  derive_global_weather: buildDeriveRequestInputSchema([
    'pattern',
    'severe-setup',
    'winter',
    'heavy-rain',
    'temperature-anomaly',
  ]),
  derive_radar_nowcast: buildDeriveRequestInputSchema([
    'storm-objects',
    'rotation',
    'hail',
    'wind',
    'training-rain',
    'precipitation',
  ]),
  derive_satellite_weather: buildDeriveRequestInputSchema([
    'cloud-top',
    'convective-initiation',
    'moisture-plume',
    'low-clouds',
    'fog',
    'lightning',
  ]),
  derive_hydrology_weather: buildDeriveRequestInputSchema([
    'river-flood',
    'flash-flood',
    'peak-flow',
    'hydro-timing',
    'winter-hydrology',
  ]),
  synthesize_weather_conclusion: synthesizeWeatherInputSchema,
}

export function sanitizeToolsForGemini(
  tools: Array<AnyServerTool>,
): Array<AnyServerTool> {
  return tools.map((tool) => {
    const inputSchema = geminiInputSchemaByToolName[tool.name]
    if (!inputSchema) {
      return tool
    }

    return {
      ...tool,
      inputSchema,
    }
  })
}
