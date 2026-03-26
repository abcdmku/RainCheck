import type { UIMessage } from '@tanstack/ai'
import { Check, ChevronDown, Copy, RotateCcw, SquarePen, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
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
  get_aviation_context: 'Aviation Context',
  get_fire_weather_products: 'Fire Weather',
  get_global_guidance: 'Global Guidance',
  get_precip_flood_context: 'Precipitation And Flood Context',
  get_radar_satellite_nowcast: 'Radar, Satellite, And Nowcast',
  get_severe_context: 'Severe Context',
  get_short_range_guidance: 'Short Range Guidance',
  get_wpc_medium_range_hazards: 'Medium Range Hazards',
  get_wpc_winter_weather: 'Winter Weather',
}

const hiddenToolOutputNames = new Set([
  'resolve_location',
  'get_current_conditions',
  'get_forecast',
  'get_alerts',
  'get_short_range_guidance',
  'get_global_guidance',
  'get_severe_context',
  'get_precip_flood_context',
  'get_radar_satellite_nowcast',
  'get_aviation_context',
  'get_fire_weather_products',
  'get_wpc_winter_weather',
  'get_wpc_medium_range_hazards',
  'get_tropical_weather',
  'get_marine_ocean_guidance',
  'get_upper_air_soundings',
  'get_historical_climate',
  'get_storm_history',
  'request_geolocation_permission',
  'generate_citation_bundle',
  'copy_to_clipboard',
  'save_ui_preference',
  'open_artifact_view',
  'synthesize_weather_conclusion',
])

function shouldHideToolOutput(name: string | undefined) {
  return Boolean(name && hiddenToolOutputNames.has(name))
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

function isWeatherConclusion(output: unknown): output is Record<string, any> {
  return (
    isRecord(output) &&
    typeof output.bottomLine === 'string' &&
    typeof output.confidence !== 'undefined'
  )
}

function isReportOutline(output: unknown): output is Record<string, any> {
  return (
    isRecord(output) &&
    typeof output.title === 'string' &&
    Array.isArray(output.sections)
  )
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

function collectProducts(
  output: Record<string, any>,
): Array<Record<string, any>> {
  const products = Array.isArray(output.data?.products)
    ? output.data.products
    : Array.isArray(output.productCards)
      ? output.productCards
      : Array.isArray(output.recommendedArtifacts)
        ? output.recommendedArtifacts
        : []

  return products.filter(
    (product: unknown): product is Record<string, any> => isRecord(product),
  )
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

function getPreviewSource(partName: string, output: Record<string, any>) {
  if (typeof output.sourceName === 'string') {
    return output.sourceName
  }

  return previewTitleByTool[partName] ?? titleCase(formatToolLabel(partName))
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

function getPreviewSourceUrl(output: Record<string, any>) {
  const highlightedProduct = findHighlightedProduct(output)
  if (typeof highlightedProduct?.url === 'string') {
    return highlightedProduct.url
  }

  const firstCitation = Array.isArray(output.citations)
    ? output.citations.find(
        (c: unknown) => isRecord(c) && typeof c.url === 'string',
      )
    : null
  return firstCitation?.url ?? undefined
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
  const sourceLabel = getPreviewSource(partName, output)
  const severity = formatToolValue(output.severity)

  if (!resolvedArtifact || !imageUrl) {
    return (
      <ToolSummaryCard
        citations={output.citations}
        summary={`Used ${title} to gather weather product context.`}
        title={title}
      />
    )
  }

  const sourceUrl = getPreviewSourceUrl(output)

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
      <div className="product-card-footer">
        <p>{title}</p>
        {sourceUrl ? (
          <a
            href={sourceUrl}
            onClick={(e) => e.stopPropagation()}
            rel="noreferrer"
            target="_blank"
          >
            View source
          </a>
        ) : null}
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

function CollapsibleSources({ citations }: { citations: Array<any> }) {
  const [open, setOpen] = useState(false)

  if (!citations.length) {
    return null
  }

  return (
    <div className={`sources-collapse${open ? ' is-open' : ''}`}>
      <button
        className="sources-collapse-trigger"
        onClick={() => setOpen((prev) => !prev)}
        type="button"
      >
        <span className="sources-collapse-count">{citations.length}</span>
        <span>sources</span>
        <ChevronDown className="sources-collapse-chevron" size={14} />
      </button>
      {open ? (
        <div className="sources-collapse-body">
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
      ) : null}
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
  if (shouldHideToolOutput(part.name)) {
    return null
  }

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
    return <CollapsibleSources citations={part.output.citations ?? []} />
  }

  if (part.name === 'synthesize_weather_conclusion') {
    return null
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

  return (
    <ToolSummaryCard
      summary={`Used ${formatToolLabel(part.name)} to gather supporting context.`}
      title={formatToolLabel(part.name)}
    />
  )
}

/* ── Inline edit textarea ────────────────────── */

function InlineEdit({
  initialText,
  onSave,
  onCancel,
}: {
  initialText: string
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(initialText)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    const el = textareaRef.current
    if (el) {
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
      el.setSelectionRange(el.value.length, el.value.length)
    }
  }, [])

  return (
    <div className="inline-edit">
      <textarea
        ref={textareaRef}
        className="inline-edit-input"
        onChange={(e) => {
          setDraft(e.target.value)
          e.target.style.height = 'auto'
          e.target.style.height = `${e.target.scrollHeight}px`
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            onSave(draft.trim())
          }
          if (e.key === 'Escape') {
            onCancel()
          }
        }}
        value={draft}
      />
      <div className="inline-edit-actions">
        <button
          className="ghost-icon-button"
          onClick={onCancel}
          type="button"
          aria-label="Cancel edit"
        >
          <X size={14} />
        </button>
        <button
          className="ghost-icon-button"
          disabled={!draft.trim()}
          onClick={() => onSave(draft.trim())}
          type="button"
          aria-label="Save edit"
        >
          <Check size={14} />
        </button>
      </div>
    </div>
  )
}

/* ── Main MessageView ────────────────────────── */

export function MessageView({
  message,
  isLastAssistant,
  isStreaming,
  suppressThinkingIndicator,
  liveStatusLabel,
  onCopy,
  onEditAndResend,
  onRetry,
  onOpenArtifact,
}: {
  message: UIMessage
  isLastAssistant: boolean
  isStreaming?: boolean
  suppressThinkingIndicator?: boolean
  liveStatusLabel?: string | null
  onCopy: (text: string) => void
  onEditAndResend: (messageId: string, newText: string) => void
  onRetry: () => void
  onOpenArtifact: (artifact: OpenableArtifact) => void
}) {
  const [editing, setEditing] = useState(false)
  const text = getMessageText(message as any)
  const citations = Array.isArray((message as any).citations)
    ? ((message as any).citations as Array<any>)
    : []
  const visibleParts = message.parts.filter((part: any) =>
    part.type === 'tool-call'
      ? !shouldHideToolOutput(part.name) && !isWeatherConclusion(part.output)
      : true,
  )

  const hasTools = visibleParts.some((part: any) => part.type === 'tool-call')
  const hasToolCitations = message.parts.some(
    (part: any) => part.type === 'tool-call' && part.name === 'generate_citation_bundle',
  )

  // For assistant messages: render parts in order (tools first if they come first,
  // text after). We respect the original part order from the stream.
  const isAssistant = message.role === 'assistant'
  const isUser = message.role === 'user'
  const hasText = text.trim().length > 0

  // Detect "thinking" state: assistant message that is streaming with no text yet
  const isThinking =
    isAssistant &&
    isStreaming &&
    !hasText &&
    !hasTools &&
    !suppressThinkingIndicator
  const showLiveStatus =
    isAssistant &&
    isStreaming &&
    !hasText &&
    !hasTools &&
    Boolean(liveStatusLabel)
  const hideEmptyAssistantMessage =
    isAssistant &&
    !hasText &&
    !hasTools &&
    !isThinking &&
    !showLiveStatus &&
    citations.length === 0

  const canCopy = hasText
  const canEdit = isUser && hasText
  const canRetry = isAssistant && isLastAssistant && !isStreaming
  const hasActions = canCopy || canEdit || canRetry

  const actionsRow = !editing && hasActions ? (
    <div className="message-actions">
      {canCopy ? (
        <button
          aria-label="Copy message"
          className="ghost-icon-button"
          onClick={() => onCopy(text)}
          type="button"
        >
          <Copy size={14} />
        </button>
      ) : null}
      {canEdit ? (
        <button
          aria-label="Edit message"
          className="ghost-icon-button"
          onClick={() => setEditing(true)}
          type="button"
        >
          <SquarePen size={14} />
        </button>
      ) : null}
      {canRetry ? (
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
  ) : null

  if (hideEmptyAssistantMessage) {
    return null
  }

  return (
    <article className={isUser ? 'message-row is-user' : 'message-row'}>
      <div className={isUser ? 'message-wrap is-user' : 'message-wrap'}>
        <div className={isUser ? 'message-bubble is-user' : 'message-bubble'}>
          {isUser && editing ? (
            <InlineEdit
              initialText={text}
              onCancel={() => setEditing(false)}
              onSave={(newText) => {
                setEditing(false)
                if (newText && newText !== text) {
                  onEditAndResend(message.id, newText)
                }
              }}
            />
          ) : (
            <>
              {isThinking ? (
                <div className="thinking-indicator">
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                  <span className="thinking-dot" />
                </div>
              ) : null}
              {showLiveStatus ? (
                <div
                  aria-live="polite"
                  className="assistant-status"
                  role="status"
                >
                  <div className="thinking-indicator">
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                    <span className="thinking-dot" />
                  </div>
                  <span className="assistant-status-label">{liveStatusLabel}</span>
                </div>
              ) : null}

              {isAssistant ? (
                /* Assistant: render parts in stream order */
                visibleParts.map((part: any) => {
                  if (part.type === 'text') {
                    const partText = part.content ?? part.text ?? ''
                    return partText ? (
                      <div
                        className="message-markdown"
                        key={part.id ?? `text-${partText.slice(0, 20)}`}
                      >
                        <Streamdown>{partText}</Streamdown>
                      </div>
                    ) : null
                  }
                  if (part.type === 'tool-call') {
                    return (
                      <ToolOutput
                        key={part.id}
                        onOpenArtifact={onOpenArtifact}
                        part={part}
                      />
                    )
                  }
                  return null
                })
              ) : /* User: just text */
              text ? (
                <div className="message-markdown">
                  <Streamdown>{text}</Streamdown>
                </div>
              ) : null}
              {isAssistant && citations.length > 0 && !hasToolCitations ? (
                <CollapsibleSources citations={citations} />
              ) : null}
            </>
          )}
        </div>

        {/* Actions always outside the bubble */}
        {actionsRow}
      </div>
    </article>
  )
}
