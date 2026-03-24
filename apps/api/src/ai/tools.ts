import {
  generateArtifactToolDef,
  generateCitationBundleToolDef,
  generateReportOutlineToolDef,
  getAlertsToolDef,
  getAviationSummaryToolDef,
  getCurrentConditionsToolDef,
  getForecastToolDef,
  getHydrologySummaryToolDef,
  getSevereSummaryToolDef,
  type RequestClassification,
  resolveLocationToolDef,
} from '@raincheck/contracts'

import type { ServerTool } from '@tanstack/ai'
import type { FastifyInstance } from 'fastify'
import { getAviationSummary } from '../weather/aviation'
import { geocodeQuery } from '../weather/geocode'
import {
  getAlerts,
  getCurrentConditions,
  getForecast,
  getSevereSummary,
} from '../weather/nws'
import { generateArtifact } from '../weather/service-client'
import { chooseSourceManifests } from '../weather/source-selection'

function withProgress<TArgs, TResult>(
  label: string,
  handler: (args: TArgs) => Promise<TResult>,
) {
  return async (
    args: TArgs,
    context?: {
      emitCustomEvent?: (name: string, value: Record<string, unknown>) => void
    },
  ) => {
    context?.emitCustomEvent?.('tool-progress', {
      label,
    })
    return handler(args)
  }
}

export function buildServerTools(
  app: FastifyInstance,
  classification: RequestClassification,
) {
  const resolveLocation = resolveLocationToolDef.server(
    withProgress('Resolving location', ({ query }) => geocodeQuery(app, query)),
  )
  const currentConditions = getCurrentConditionsToolDef.server(
    withProgress('Fetching current conditions', ({ locationQuery }) =>
      getCurrentConditions(app, locationQuery),
    ),
  )
  const forecast = getForecastToolDef.server(
    withProgress('Fetching forecast', ({ locationQuery, horizon }) =>
      getForecast(app, locationQuery, horizon),
    ),
  )
  const alerts = getAlertsToolDef.server(
    withProgress('Fetching alerts', ({ locationQuery }) =>
      getAlerts(app, locationQuery),
    ),
  )
  const aviation = getAviationSummaryToolDef.server(
    withProgress('Fetching aviation weather', ({ stationId }) =>
      getAviationSummary(app, stationId),
    ),
  )
  const severe = getSevereSummaryToolDef.server(
    withProgress('Summarizing severe setup', ({ locationQuery }) =>
      getSevereSummary(app, locationQuery),
    ),
  )
  const hydrology = getHydrologySummaryToolDef.server(
    withProgress('Summarizing hydrology', async ({ locationQuery }) => ({
      gaugeName: locationQuery,
      summary:
        'Hydrology support is scaffolded. NWPS integration can supply river-stage context when enabled.',
      floodCategory: null,
      observedAt: null,
      citations: [],
    })),
  )
  const citations = generateCitationBundleToolDef.server(
    withProgress('Assembling sources', async ({ sourceIds, productIds }) => ({
      citations: sourceIds.map((sourceId, index) => ({
        id: `${sourceId}:${productIds[index] ?? 'catalog'}`,
        label: `${sourceId} ${productIds[index] ?? 'catalog'}`,
        sourceId,
        productId: productIds[index] ?? 'catalog',
      })),
      manifests: chooseSourceManifests(classification).filter((manifest) =>
        sourceIds.includes(manifest.sourceId),
      ),
    })),
  )
  const reportOutline = generateReportOutlineToolDef.server(
    withProgress('Planning brief', async ({ title, focus }) => ({
      title,
      sections: [
        { heading: 'Setup', summary: focus },
        {
          heading: 'Main risks',
          summary: 'Highlight the most relevant hazards or forecast questions.',
        },
        {
          heading: 'Confidence',
          summary: 'State uncertainty and what could change.',
        },
      ],
    })),
  )
  const artifact = generateArtifactToolDef.server(
    withProgress(
      classification.intent === 'radar-analysis'
        ? 'Generating radar artifact'
        : 'Writing brief',
      ({ artifactType, locationQuery, prompt }) =>
        generateArtifact(app, { artifactType, locationQuery, prompt }),
    ),
  )

  const commonTools: Array<ServerTool<any, any>> = [
    resolveLocation,
    currentConditions,
    forecast,
    alerts,
    citations,
  ]

  switch (classification.intent) {
    case 'aviation':
      return [...commonTools, aviation]
    case 'hydrology':
      return [...commonTools, hydrology, artifact, reportOutline]
    case 'model-comparison':
    case 'radar-analysis':
    case 'research-brief':
      return [...commonTools, severe, artifact, reportOutline]
    default:
      return commonTools
  }
}
