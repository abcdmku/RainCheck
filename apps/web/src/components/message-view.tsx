import type { UIMessage } from '@tanstack/ai'
import { Copy, RotateCcw, SquarePen } from 'lucide-react'
import { Streamdown } from 'streamdown'

import { resolveApiUrl } from '../lib/api'
import { getMessageText } from '../lib/messages'

const DEGREE = '\u00B0'

type OpenableArtifact = {
  href: string
  title: string
  mimeType: string
  imageAlt?: string
}

const previewTitleByTool: Record<string, string> = {
  compare_models: 'Model Comparison',
  get_blend_and_analysis_guidance: 'Blend And Analysis Guidance',
  get_global_model_guidance: 'Global Model Guidance',
  get_goes_satellite: 'Satellite',
  get_hydrology_nwps: 'Hydrology',
  get_nexrad_radar: 'Radar',
  get_spc_severe_products: 'Severe Outlook',
  get_wpc_qpf_ero: 'Rainfall Outlook',
}

function titleCase(value: string) {
  return value
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function formatToolLabel(name: string) {
  return name
    .replace(/^get_/, '')
    .replace(/^generate_/, '')
    .replace(/^resolve_/, '')
    .replaceAll('_', ' ')
}

function formatToolValue(value: unknown) {
  return typeof value === 'string' ? value : undefined
}

function isRecord(value: unknown): value is Record<string, any> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isWeatherEnvelope(output: unknown): output is Record<string, any> {
  return (
    isRecord(output) &&
    typeof output.summary === 'string' &&
    isRecord(output.location) &&
    isRecord(output.data)
  )
}

function isArtifactOutput(output: unknown): output is Record<string, any> {
  return (
    isRecord(output) &&
    typeof output.href === 'string' &&
    typeof output.title === 'string' &&
    typeof output.mimeType === 'string'
  )
}

function isLocationOutput(output: unknown): output is Record<string, any> {
  return (
    isRecord(output) &&
    typeof output.name === 'string' &&
    typeof output.latitude === 'number' &&
    typeof output.longitude === 'number'
  )
}

function isReportOutline(output: unknown): output is Record<string, any> {
  return (
    isRecord(output) &&
    typeof output.title === 'string' &&
    Array.isArray(output.sections)
  )
}

function isModelComparison(output: unknown): output is Record<string, any> {
  return (
    isRecord(output) &&
    typeof output.consensus === 'string' &&
    Array.isArray(output.comparedModels)
  )
}

function formatDateLabel(value: string) {
  const parsed = new Date(value)
  if (Number.isNaN(parsed.valueOf())) {
    return value
  }

  return new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    month: 'short',
  }).format(parsed)
}

function formatValidLabel(output: Record<string, any>) {
  if (
    isRecord(output.validRange) &&
    typeof output.validRange.start === 'string' &&
    typeof output.validRange.end === 'string'
  ) {
    return `${formatDateLabel(output.validRange.start)} - ${formatDateLabel(output.validRange.end)}`
  }

  if (typeof output.validAt === 'string') {
    return formatDateLabel(output.validAt)
  }

  return undefined
}

function inferMimeTypeFromUrl(url: string) {
  const normalized = url.split('?')[0]?.toLowerCase() ?? url.toLowerCase()
  if (normalized.endsWith('.gif')) {
    return 'image/gif'
  }
  if (normalized.endsWith('.png')) {
    return 'image/png'
  }
  if (normalized.endsWith('.svg')) {
    return 'image/svg+xml'
  }
  if (normalized.endsWith('.webp')) {
    return 'image/webp'
  }

  return 'image/jpeg'
}

function summarizeLine(value: string, maxChars = 120) {
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxChars) {
    return normalized
  }

  return `${normalized.slice(0, maxChars).trimEnd()}...`
}

function collectProducts(output: Record<string, any>) {
  return Array.isArray(output.data?.products)
    ? output.data.products.filter(
        (product: unknown): product is Record<string, any> => isRecord(product),
      )
    : []
}

function findHighlightedProduct(output: Record<string, any>) {
  const products: Array<Record<string, any>> = collectProducts(output)
  const thumbnailUrl =
    typeof output.thumbnailUrl === 'string' ? output.thumbnailUrl : undefined

  return (
    products.find(
      (product: Record<string, any>) => product.imageUrl === thumbnailUrl,
    ) ??
    products.find(
      (product: Record<string, any>) =>
        typeof product.locationRelevance === 'string',
    ) ??
    products[0]
  )
}

function getPreviewTitle(partName: string, output: Record<string, any>) {
  const highlightedProduct = findHighlightedProduct(output)
  if (typeof highlightedProduct?.title === 'string') {
    return highlightedProduct.title
  }

  if (typeof output.title === 'string') {
    return output.title
  }

  return previewTitleByTool[partName] ?? titleCase(formatToolLabel(partName))
}

function getPreviewSummary(partName: string, output: Record<string, any>) {
  const title = getPreviewTitle(partName, output)
  const summary =
    typeof output.summary === 'string'
      ? output.summary
      : typeof output.consensus === 'string'
        ? output.consensus
        : ''

  if (summary.startsWith(`${title}: `)) {
    return summarizeLine(summary.slice(title.length + 2))
  }

  return summarizeLine(summary)
}

function getPreviewSource(partName: string, output: Record<string, any>) {
  if (typeof output.sourceName === 'string') {
    return output.sourceName
  }

  if (Array.isArray(output.comparedModels)) {
    return `${output.comparedModels.length} models`
  }

  return previewTitleByTool[partName] ?? titleCase(formatToolLabel(partName))
}

function getPreviewLocation(output: Record<string, any>) {
  if (typeof output.location?.name === 'string') {
    return output.location.name
  }

  if (typeof output.locationName === 'string') {
    return output.locationName
  }

  return undefined
}

function findArtifactHandle(output: Record<string, any>, artifactId: string) {
  if (!Array.isArray(output.artifacts)) {
    return null
  }

  return (
    output.artifacts.find(
      (artifact) => isRecord(artifact) && artifact.artifactId === artifactId,
    ) ?? null
  )
}

function resolvePreviewArtifact(
  output: Record<string, any>,
  fallbackTitle: string,
): OpenableArtifact | null {
  const artifactId =
    formatToolValue(output.fullArtifactId) ??
    formatToolValue(output.previewArtifactId)
  const artifact = artifactId ? findArtifactHandle(output, artifactId) : null

  if (
    artifact &&
    typeof artifact.href === 'string' &&
    typeof artifact.title === 'string' &&
    typeof artifact.mimeType === 'string'
  ) {
    return {
      href: artifact.href,
      title: artifact.title,
      mimeType: artifact.mimeType,
      imageAlt: formatToolValue(output.imageAlt) ?? fallbackTitle,
    }
  }

  if (typeof output.thumbnailUrl === 'string') {
    return {
      href: output.thumbnailUrl,
      title: fallbackTitle,
      mimeType: inferMimeTypeFromUrl(output.thumbnailUrl),
      imageAlt: formatToolValue(output.imageAlt) ?? fallbackTitle,
    }
  }

  const firstArtifact = Array.isArray(output.artifacts)
    ? output.artifacts.find(isRecord)
    : null
  if (
    firstArtifact &&
    typeof firstArtifact.href === 'string' &&
    typeof firstArtifact.title === 'string' &&
    typeof firstArtifact.mimeType === 'string'
  ) {
    return {
      href: firstArtifact.href,
      title: firstArtifact.title,
      mimeType: firstArtifact.mimeType,
      imageAlt: formatToolValue(output.imageAlt) ?? fallbackTitle,
    }
  }

  return null
}

function getPreviewImageUrl(
  output: Record<string, any>,
  resolvedArtifact: OpenableArtifact | null,
) {
  if (typeof output.thumbnailUrl === 'string') {
    return output.thumbnailUrl
  }

  if (resolvedArtifact?.mimeType.includes('image')) {
    return resolvedArtifact.href
  }

  const highlightedProduct = findHighlightedProduct(output)
  return typeof highlightedProduct?.imageUrl === 'string'
    ? highlightedProduct.imageUrl
    : undefined
}

function hasPreviewCard(output: Record<string, any>) {
  const title = getPreviewTitle('preview', output)
  const artifact = resolvePreviewArtifact(output, title)
  return Boolean(getPreviewImageUrl(output, artifact))
}

function SourceChipWrap({ citations }: { citations: Array<any> }) {
  if (!citations.length) {
    return null
  }

  return (
    <div className="source-chip-wrap">
      {citations.map((citation) => {
        const label = citation.label ?? citation.sourceId ?? 'Source'
        if (citation.url) {
          return (
            <a
              className="source-chip"
              href={citation.url}
              key={citation.id ?? `${label}-${citation.url}`}
              rel="noreferrer"
              target="_blank"
            >
              {label}
            </a>
          )
        }

        return (
          <span className="source-chip" key={citation.id ?? label}>
            {label}
          </span>
        )
      })}
    </div>
  )
}

function ToolSummaryCard({
  title,
  subtitle,
  summary,
  citations,
}: {
  title: string
  subtitle?: string
  summary: string
  citations?: Array<any>
}) {
  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <p>{title}</p>
        {subtitle ? <span>{subtitle}</span> : null}
      </div>
      <p className="tool-summary">{summary}</p>
      {citations?.length ? <SourceChipWrap citations={citations} /> : null}
    </div>
  )
}

function ProductPreviewCard({
  output,
  partName,
  onOpenArtifact,
}: {
  output: Record<string, any>
  partName: string
  onOpenArtifact: (artifact: OpenableArtifact) => void
}) {
  const title = getPreviewTitle(partName, output)
  const resolvedArtifact = resolvePreviewArtifact(output, title)
  const imageUrl = getPreviewImageUrl(output, resolvedArtifact)
  const validLabel = formatValidLabel(output)
  const sourceLabel = getPreviewSource(partName, output)
  const locationLabel = getPreviewLocation(output)
  const summary = getPreviewSummary(partName, output)
  const severity = formatToolValue(output.severity)

  if (!resolvedArtifact || !imageUrl) {
    return (
      <ToolSummaryCard
        citations={output.citations}
        subtitle={locationLabel}
        summary={summary || `Used ${title} to gather weather product context.`}
        title={title}
      />
    )
  }

  return (
    <button
      aria-label={`Open ${title}`}
      className="product-card"
      onClick={() => onOpenArtifact(resolvedArtifact)}
      type="button"
    >
      <div className="product-card-media">
        <img
          alt={formatToolValue(output.imageAlt) ?? title}
          className="product-card-image"
          src={resolveApiUrl(imageUrl)}
        />
        <div className="product-card-overlay">
          <span className="product-card-chip">{sourceLabel}</span>
          {severity ? (
            <span className="product-card-chip is-severity">{severity}</span>
          ) : null}
        </div>
      </div>
      <div className="product-card-body">
        <div className="product-card-header">
          <p>{title}</p>
          {validLabel ? <span>{validLabel}</span> : null}
        </div>
        {locationLabel ? (
          <p className="product-card-location">{locationLabel}</p>
        ) : null}
        <p className="product-card-summary">{summary}</p>
      </div>
    </button>
  )
}

function CurrentConditionsCard({ output }: { output: Record<string, any> }) {
  const current = output.data?.current
  if (!current) {
    return (
      <ToolSummaryCard
        citations={output.citations}
        subtitle={output.location?.name}
        summary={output.summary}
        title="Current conditions"
      />
    )
  }

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <p>Current conditions</p>
        <span>{output.location?.name}</span>
      </div>
      <div className="tool-grid">
        <div>
          <strong>
            {current.temperature?.value}
            {DEGREE}
            {current.temperature?.unit}
          </strong>
          <span>{current.textDescription}</span>
        </div>
        <div>
          <strong>{current.wind?.speed ?? 'Calm'} mph</strong>
          <span>{current.wind?.direction ?? 'Variable'} wind</span>
        </div>
      </div>
      <SourceChipWrap citations={output.citations ?? []} />
    </div>
  )
}

function ForecastCard({ output }: { output: Record<string, any> }) {
  const periods = Array.isArray(output.data?.periods) ? output.data.periods : []
  if (!periods.length) {
    return (
      <ToolSummaryCard
        citations={output.citations}
        subtitle={output.location?.name}
        summary={output.summary}
        title="Forecast"
      />
    )
  }

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <p>Forecast</p>
        <span>{output.location?.name}</span>
      </div>
      <p className="tool-summary">{output.summary}</p>
      <div className="forecast-stack">
        {periods.slice(0, 4).map((period: any) => (
          <div
            className="forecast-row"
            key={`${period.name}-${period.startTime}`}
          >
            <div>
              <strong>{period.name}</strong>
              <span>{period.shortForecast}</span>
            </div>
            <span>
              {period.temperature}
              {DEGREE}
              {period.temperatureUnit}
            </span>
          </div>
        ))}
      </div>
      <SourceChipWrap citations={output.citations ?? []} />
    </div>
  )
}

function AlertsCard({ output }: { output: Record<string, any> }) {
  const alerts = Array.isArray(output.data?.alerts) ? output.data.alerts : []

  return (
    <div className="tool-card is-alert">
      <div className="tool-card-header">
        <p>Alerts</p>
        <span>
          {alerts.length > 0
            ? `${alerts.length} active`
            : output.location?.name}
        </span>
      </div>
      <p className="tool-summary">{output.summary}</p>
      {alerts.length > 0 ? (
        <div className="forecast-stack">
          {alerts.slice(0, 4).map((alert: any) => (
            <div className="alert-row" key={alert.id}>
              <div>
                <strong>{alert.headline}</strong>
                <span>{alert.area}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <SourceChipWrap citations={output.citations ?? []} />
    </div>
  )
}

function SourcesCard({ output }: { output: Record<string, any> }) {
  return (
    <div className="source-card">
      <SourceChipWrap citations={output.citations ?? []} />
    </div>
  )
}

function ArtifactCard({
  output,
  onOpenArtifact,
}: {
  output: Record<string, any>
  onOpenArtifact: (artifact: OpenableArtifact) => void
}) {
  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <p>{output.title}</p>
        <span>{output.mimeType}</span>
      </div>
      <button
        aria-label={`Open ${output.title}`}
        className="primary-quiet-button"
        onClick={() =>
          onOpenArtifact({
            href: output.href,
            title: output.title,
            mimeType: output.mimeType,
          })
        }
        type="button"
      >
        Open artifact
      </button>
    </div>
  )
}

function WeatherSummaryCard({
  output,
  partName,
}: {
  output: Record<string, any>
  partName: string
}) {
  const products = collectProducts(output)
  const supplementalLines = [
    ...products.slice(0, 3).map((product: any) => ({
      title: product.title,
      summary: product.summary,
    })),
    output.data?.watchContext
      ? {
          title: 'Watches',
          summary: output.data.watchContext,
        }
      : null,
    output.data?.mesoscaleContext
      ? {
          title: 'Mesoscale',
          summary: output.data.mesoscaleContext,
        }
      : null,
    Array.isArray(output.data?.notes)
      ? output.data.notes.slice(0, 2).map((note: string, index: number) => ({
          title: index === 0 ? 'Notes' : 'Note',
          summary: note,
        }))
      : [],
  ]
    .flat()
    .filter(Boolean) as Array<{ title: string; summary: string }>

  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <p>{formatToolLabel(partName)}</p>
        <span>{output.location?.name ?? output.sourceName}</span>
      </div>
      <p className="tool-summary">{output.summary}</p>
      {supplementalLines.length > 0 ? (
        <div className="forecast-stack">
          {supplementalLines.slice(0, 4).map((item, index) => (
            <div
              className="forecast-row"
              key={`${item.title}-${index}-${item.summary.slice(0, 24)}`}
            >
              <div>
                <strong>{item.title}</strong>
                <span>{item.summary}</span>
              </div>
            </div>
          ))}
        </div>
      ) : null}
      <SourceChipWrap citations={output.citations ?? []} />
    </div>
  )
}

function ReportOutlineCard({ output }: { output: Record<string, any> }) {
  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <p>Brief outline</p>
        <span>{output.title}</span>
      </div>
      <div className="forecast-stack">
        {output.sections.slice(0, 4).map((section: any) => (
          <div className="forecast-row" key={section.heading}>
            <div>
              <strong>{section.heading}</strong>
              <span>{section.summary}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ModelComparisonCard({ output }: { output: Record<string, any> }) {
  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <p>Model comparison</p>
        <span>{output.locationName}</span>
      </div>
      <p className="tool-summary">{output.consensus}</p>
      <div className="forecast-stack">
        {output.comparedModels.slice(0, 4).map((model: any) => (
          <div
            className="forecast-row"
            key={`${model.sourceId}-${model.modelLabel}`}
          >
            <div>
              <strong>{model.modelLabel}</strong>
              <span>{model.summary}</span>
            </div>
          </div>
        ))}
      </div>
      <p className="tool-summary is-secondary">{output.uncertainty}</p>
    </div>
  )
}

function LocationCard({ output }: { output: Record<string, any> }) {
  return (
    <ToolSummaryCard
      subtitle={`${output.latitude.toFixed(2)}, ${output.longitude.toFixed(2)}`}
      summary={`Resolved to ${output.name}.`}
      title="Location"
    />
  )
}

function ErrorCard({
  partName,
  output,
}: {
  partName: string
  output: Record<string, any>
}) {
  return (
    <div className="tool-card is-alert">
      <div className="tool-card-header">
        <p>{formatToolLabel(partName)}</p>
        <span>Unavailable</span>
      </div>
      <p className="tool-summary">{output.error}</p>
    </div>
  )
}

function ToolOutput({
  part,
  onOpenArtifact,
}: {
  part: any
  onOpenArtifact: (artifact: OpenableArtifact) => void
}) {
  if (!part.output || !isRecord(part.output)) {
    const textOutput = formatToolValue(part.output)
    return textOutput ? (
      <ToolSummaryCard
        summary={textOutput}
        title={formatToolLabel(part.name)}
      />
    ) : null
  }

  if (typeof part.output.error === 'string') {
    return <ErrorCard output={part.output} partName={part.name} />
  }

  if (isArtifactOutput(part.output)) {
    return <ArtifactCard onOpenArtifact={onOpenArtifact} output={part.output} />
  }

  if (part.name === 'generate_citation_bundle') {
    return <SourcesCard output={part.output} />
  }

  if (isWeatherEnvelope(part.output)) {
    switch (part.name) {
      case 'get_current_conditions':
        return <CurrentConditionsCard output={part.output} />
      case 'get_forecast':
        return <ForecastCard output={part.output} />
      case 'get_alerts':
        return <AlertsCard output={part.output} />
      default:
        return hasPreviewCard(part.output) ? (
          <ProductPreviewCard
            onOpenArtifact={onOpenArtifact}
            output={part.output}
            partName={part.name}
          />
        ) : (
          <WeatherSummaryCard output={part.output} partName={part.name} />
        )
    }
  }

  if (isReportOutline(part.output)) {
    return <ReportOutlineCard output={part.output} />
  }

  if (isModelComparison(part.output)) {
    return hasPreviewCard(part.output) ? (
      <ProductPreviewCard
        onOpenArtifact={onOpenArtifact}
        output={part.output}
        partName={part.name}
      />
    ) : (
      <ModelComparisonCard output={part.output} />
    )
  }

  if (isLocationOutput(part.output)) {
    return <LocationCard output={part.output} />
  }

  return (
    <ToolSummaryCard
      summary={`Used ${formatToolLabel(part.name)} to gather supporting context.`}
      title={formatToolLabel(part.name)}
    />
  )
}

export function MessageView({
  message,
  isLastAssistant,
  onCopy,
  onEdit,
  onRetry,
  onOpenArtifact,
}: {
  message: UIMessage
  isLastAssistant: boolean
  onCopy: (text: string) => void
  onEdit: (text: string) => void
  onRetry: () => void
  onOpenArtifact: (artifact: OpenableArtifact) => void
}) {
  const text = getMessageText(message as any)
  const toolParts = message.parts.filter(
    (part): part is any => part.type === 'tool-call',
  )
  const hasTools = toolParts.length > 0

  return (
    <article
      className={
        message.role === 'user' ? 'message-row is-user' : 'message-row'
      }
    >
      <div
        className={
          message.role === 'user' ? 'message-bubble is-user' : 'message-bubble'
        }
      >
        {text ? (
          <div className="message-markdown">
            <Streamdown>{text}</Streamdown>
          </div>
        ) : null}
        {hasTools ? (
          <div className="tool-section">
            {toolParts.map((part) => (
              <ToolOutput
                key={part.id}
                onOpenArtifact={onOpenArtifact}
                part={part}
              />
            ))}
          </div>
        ) : null}
        <div className="message-actions">
          <button
            aria-label="Copy message"
            className="ghost-icon-button"
            onClick={() => onCopy(text)}
            type="button"
          >
            <Copy size={14} />
          </button>
          {message.role === 'user' ? (
            <button
              aria-label="Edit message"
              className="ghost-icon-button"
              onClick={() => onEdit(text)}
              type="button"
            >
              <SquarePen size={14} />
            </button>
          ) : null}
          {message.role === 'assistant' && isLastAssistant ? (
            <button
              aria-label="Retry response"
              className="ghost-icon-button"
              onClick={onRetry}
              type="button"
            >
              <RotateCcw size={14} />
            </button>
          ) : null}
        </div>
      </div>
    </article>
  )
}
