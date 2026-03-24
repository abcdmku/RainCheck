import { LoaderCircle, SendHorizontal } from 'lucide-react'

type ComposerProps = {
  value: string
  isLoading: boolean
  onChange: (next: string) => void
  onSubmit: () => void
  onCancelEdit: () => void
  editingLabel?: string | null
}

export function Composer({
  value,
  isLoading,
  onChange,
  onSubmit,
  onCancelEdit,
  editingLabel,
}: ComposerProps) {
  return (
    <div className="composer-shell">
      {editingLabel ? (
        <div className="composer-banner">
          <div>
            <p className="composer-banner-label">Editing</p>
            <p className="composer-banner-value">{editingLabel}</p>
          </div>
          <button className="ghost-button" onClick={onCancelEdit} type="button">
            Cancel
          </button>
        </div>
      ) : null}
      <div className="composer-surface">
        <textarea
          aria-label="Ask RainCheck about the weather"
          className="composer-input"
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              onSubmit()
            }
          }}
          placeholder="Ask about weather anywhere..."
          rows={1}
          value={value}
        />
        <div className="composer-actions">
          <span />
          <button
            className="primary-button"
            disabled={isLoading || value.trim().length === 0}
            onClick={onSubmit}
            type="button"
          >
            {isLoading ? (
              <LoaderCircle className="spin" size={15} />
            ) : (
              <SendHorizontal size={15} />
            )}
            Send
          </button>
        </div>
      </div>
    </div>
  )
}
