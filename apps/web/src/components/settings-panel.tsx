import { X } from 'lucide-react'
import { useEffect, useState } from 'react'

import type { SettingsPayload } from '../lib/api'

type SettingsPanelProps = {
  isOpen: boolean
  settings: SettingsPayload | null
  onClose: () => void
  onSave: (next: SettingsPayload) => Promise<void>
  onStoreByok: (providerId: string, apiKey: string) => Promise<void>
  onClearByok: (providerId: string) => Promise<void>
}

const providerRows = ['openai', 'anthropic', 'gemini', 'openrouter']

export function SettingsPanel({
  isOpen,
  settings,
  onClose,
  onSave,
  onStoreByok,
  onClearByok,
}: SettingsPanelProps) {
  const [draft, setDraft] = useState<SettingsPayload | null>(settings)
  const [keyDrafts, setKeyDrafts] = useState<Record<string, string>>({})

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  if (!isOpen || !draft) {
    return null
  }

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop closes the panel when the backdrop itself is clicked */
    <div
      className="settings-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
      onKeyDown={(event) => {
        if (
          event.target === event.currentTarget &&
          (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape')
        ) {
          event.preventDefault()
          onClose()
        }
      }}
      role="presentation"
      tabIndex={-1}
    >
      <div aria-modal="true" className="settings-panel" role="dialog">
        <div className="settings-header">
          <div>
            <p className="sidebar-brand">Settings</p>
            <p className="sidebar-caption">
              Theme, units, provider defaults, and BYOK.
            </p>
          </div>
          <button className="ghost-icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>

        <div className="settings-grid">
          <label className="settings-field">
            <span>Theme</span>
            <select
              value={draft.theme}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  theme: event.target.value as SettingsPayload['theme'],
                })
              }
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="system">System</option>
            </select>
          </label>

          <label className="settings-field">
            <span>Units</span>
            <select
              value={draft.units}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  units: event.target.value as SettingsPayload['units'],
                })
              }
            >
              <option value="imperial">Imperial</option>
              <option value="metric">Metric</option>
            </select>
          </label>

          <label className="settings-field is-wide">
            <span>Default location label</span>
            <input
              value={draft.defaultLocationLabel ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  defaultLocationLabel: event.target.value || null,
                })
              }
            />
          </label>
        </div>

        <div className="settings-section">
          <div className="tool-card-header">
            <p>Bring your own key</p>
          </div>
          <div className="forecast-stack">
            {providerRows.map((providerId) => {
              const byokState = draft.byok?.find(
                (entry: any) => entry.providerId === providerId,
              )
              return (
                <div className="byok-row" key={providerId}>
                  <div>
                    <strong>{providerId}</strong>
                    <span>
                      {byokState?.configured ? 'Configured' : 'Not configured'}
                    </span>
                  </div>
                  <input
                    placeholder="Paste API key"
                    type="password"
                    value={keyDrafts[providerId] ?? ''}
                    onChange={(event) =>
                      setKeyDrafts((current) => ({
                        ...current,
                        [providerId]: event.target.value,
                      }))
                    }
                  />
                  <button
                    className="primary-quiet-button"
                    onClick={() =>
                      onStoreByok(providerId, keyDrafts[providerId] ?? '')
                    }
                    type="button"
                  >
                    Save
                  </button>
                  <button
                    className="ghost-button"
                    onClick={() => onClearByok(providerId)}
                    type="button"
                  >
                    Clear
                  </button>
                </div>
              )
            })}
          </div>
        </div>

        <div className="settings-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            Close
          </button>
          <button
            className="primary-button"
            onClick={() => onSave(draft)}
            type="button"
          >
            Save settings
          </button>
        </div>
      </div>
    </div>
  )
}
