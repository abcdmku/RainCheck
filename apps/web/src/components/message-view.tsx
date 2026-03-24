import type { UIMessage } from '@tanstack/ai'
import { Copy, RotateCcw, SquarePen } from 'lucide-react'
import { Streamdown } from 'streamdown'

import { getMessageText } from '../lib/messages'

const DEGREE = '\u00B0'

function CurrentConditionsCard({ output }: { output: any }) {
  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <p>Current conditions</p>
        <span>{output.location?.name}</span>
      </div>
      <div className="tool-grid">
        <div>
          <strong>
            {output.temperature?.value}
            {DEGREE}
            {output.temperature?.unit}
          </strong>
          <span>{output.textDescription}</span>
        </div>
        <div>
          <strong>{output.wind?.speed ?? 'Calm'} mph</strong>
          <span>{output.wind?.direction ?? 'Variable'} wind</span>
        </div>
      </div>
    </div>
  )
}

function ForecastCard({ output }: { output: any }) {
  return (
    <div className="tool-card">
      <div className="tool-card-header">
        <p>Forecast</p>
        <span>{output.location?.name}</span>
      </div>
      <div className="forecast-stack">
        {output.periods?.slice(0, 4).map((period: any) => (
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
    </div>
  )
}

function AlertsCard({ output }: { output: Array<any> }) {
  if (!output?.length) {
    return null
  }

  return (
    <div className="tool-card is-alert">
      <div className="tool-card-header">
        <p>Alerts</p>
        <span>{output.length} active</span>
      </div>
      <div className="forecast-stack">
        {output.map((alert) => (
          <div className="alert-row" key={alert.id}>
            <div>
              <strong>{alert.headline}</strong>
              <span>{alert.area}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SourcesCard({ output }: { output: any }) {
  return (
    <div className="source-card">
      <div className="source-chip-wrap">
        {output.citations?.map((citation: any) => (
          <a
            className="source-chip"
            href={citation.url}
            key={citation.id}
            rel="noreferrer"
            target="_blank"
          >
            {citation.label}
          </a>
        ))}
      </div>
    </div>
  )
}

function ArtifactCard({
  output,
  onOpenArtifact,
}: {
  output: any
  onOpenArtifact: (artifact: {
    href: string
    title: string
    mimeType: string
  }) => void
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

function ToolOutput({
  part,
  onOpenArtifact,
}: {
  part: any
  onOpenArtifact: (artifact: {
    href: string
    title: string
    mimeType: string
  }) => void
}) {
  if (!part.output) {
    return null
  }

  switch (part.name) {
    case 'get_current_conditions':
      return <CurrentConditionsCard output={part.output} />
    case 'get_forecast_summary':
      return <ForecastCard output={part.output} />
    case 'get_alerts':
      return <AlertsCard output={part.output as Array<any>} />
    case 'generate_citation_bundle':
      return <SourcesCard output={part.output} />
    case 'generate_artifact':
      return (
        <ArtifactCard onOpenArtifact={onOpenArtifact} output={part.output} />
      )
    default:
      return (
        <div className="tool-card">
          <div className="tool-card-header">
            <p>{part.name.replaceAll('_', ' ')}</p>
          </div>
          <pre className="tool-json">
            {JSON.stringify(part.output, null, 2)}
          </pre>
        </div>
      )
  }
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
  onOpenArtifact: (artifact: {
    href: string
    title: string
    mimeType: string
  }) => void
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
