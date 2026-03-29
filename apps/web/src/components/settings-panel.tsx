import type {
  DesktopLocalCliConnectionState,
  ProviderConnectionState,
  ProviderId,
} from '@raincheck/contracts'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { SettingsPayload } from '../lib/api'

type SettingsPanelProps = {
  isOpen: boolean
  isDesktop: boolean
  settings: SettingsPayload | null
  desktopProviderConnections: Array<DesktopLocalCliConnectionState>
  onClose: () => void
  onSave: (next: SettingsPayload) => Promise<void>
  onSaveProviderApiKey: (providerId: string, apiKey: string) => Promise<void>
  onClearProviderConnection: (providerId: string) => Promise<void>
}

type ProviderRow = {
  id: ProviderId
  label: string
  localCliLabel?: string
  localCliLoginCommand?: string
}

const providerRows: Array<ProviderRow> = [
  {
    id: 'openai',
    label: 'OpenAI',
    localCliLabel: 'Codex',
    localCliLoginCommand: 'codex login',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    localCliLabel: 'Claude Code',
    localCliLoginCommand: 'claude auth login',
  },
  {
    id: 'gemini',
    label: 'Gemini',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
  },
]

function connectionStatusLabel(
  provider: ProviderRow,
  connection: ProviderConnectionState | undefined,
  localCliConnection: DesktopLocalCliConnectionState | undefined,
) {
  if (localCliConnection?.connected) {
    return `Connected via ${provider.localCliLabel}`
  }

  switch (connection?.mode) {
    case 'env':
      return 'Connected with shared API key'
    case 'api-key':
      return 'Connected with saved API key'
    default:
      return 'Not connected'
  }
}

function localCliStatusText(
  provider: ProviderRow,
  connection: DesktopLocalCliConnectionState | undefined,
) {
  if (connection?.localCli?.authReady) {
    return `${connection.localCli.statusLabel}. Select a model in the message bar.`
  }

  if (connection?.localCli?.detected) {
    return connection.localCli.statusLabel
  }

  return `${provider.localCliLabel} was not detected`
}

function localCliSetupNote(
  provider: ProviderRow,
  connection: DesktopLocalCliConnectionState | undefined,
) {
  if (connection?.localCli?.authReady) {
    return 'Connected on this desktop. Pick a native model from the message input whenever you want to use this subscription.'
  }

  if (connection?.localCli?.detected) {
    return `Run ${provider.localCliLoginCommand} if needed, then reopen settings. If you're already logged in, restart RainCheck so it refreshes the desktop CLI session.`
  }

  if (provider.localCliLabel && provider.localCliLoginCommand) {
    return `Install ${provider.localCliLabel}, then run ${provider.localCliLoginCommand}.`
  }

  return 'Local CLI setup is unavailable right now.'
}

export function SettingsPanel({
  isOpen,
  isDesktop,
  settings,
  desktopProviderConnections,
  onClose,
  onSave,
  onSaveProviderApiKey,
  onClearProviderConnection,
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
          <p className="sidebar-brand">Settings</p>
          <button className="ghost-icon-button" onClick={onClose} type="button">
            <X size={16} />
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

          <label className="settings-field">
            <span>Tone</span>
            <select
              value={draft.answerTone}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  answerTone: event.target
                    .value as SettingsPayload['answerTone'],
                })
              }
            >
              <option value="casual">Casual</option>
              <option value="professional">Professional</option>
            </select>
          </label>

          <label className="settings-field">
            <span>Weather times</span>
            <select
              value={draft.timeDisplay}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  timeDisplay: event.target
                    .value as SettingsPayload['timeDisplay'],
                })
              }
            >
              <option value="user-local">My local time</option>
              <option value="dual">Show both</option>
              <option value="target-local">Target local time</option>
            </select>
          </label>

          <label className="settings-field is-wide">
            <span>Default location</span>
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
            <p>Provider connections</p>
          </div>
          <div className="forecast-stack">
            {providerRows.map((provider) => {
              const connection = draft.providerConnections?.find(
                (entry: ProviderConnectionState) =>
                  entry.providerId === provider.id,
              )
              const localCliConnection = desktopProviderConnections.find(
                (entry) => entry.providerId === provider.id,
              )
              const canUseLocalCli =
                isDesktop && Boolean(provider.localCliLabel)
              const localCliNote = localCliSetupNote(
                provider,
                localCliConnection,
              )

              return (
                <div className="provider-connection-card" key={provider.id}>
                  <div className="provider-connection-header">
                    <div>
                      <strong>{provider.label}</strong>
                      <span>
                        {connectionStatusLabel(
                          provider,
                          connection,
                          localCliConnection,
                        )}
                      </span>
                    </div>
                  </div>

                  <div className="byok-row">
                    <div>
                      <strong>API key</strong>
                      <span>Stored on this device</span>
                    </div>
                    <input
                      placeholder="Paste API key"
                      type="password"
                      value={keyDrafts[provider.id] ?? ''}
                      onChange={(event) =>
                        setKeyDrafts((current) => ({
                          ...current,
                          [provider.id]: event.target.value,
                        }))
                      }
                    />
                    <button
                      className="primary-quiet-button"
                      onClick={() =>
                        onSaveProviderApiKey(
                          provider.id,
                          keyDrafts[provider.id] ?? '',
                        )
                      }
                      type="button"
                    >
                      Save key
                    </button>
                    <button
                      className="ghost-button"
                      disabled={!connection || connection.mode !== 'api-key'}
                      onClick={() => onClearProviderConnection(provider.id)}
                      type="button"
                    >
                      Clear key
                    </button>
                  </div>

                  {canUseLocalCli ? (
                    <div className="byok-row provider-connection-row">
                      <div>
                        <strong>{provider.localCliLabel}</strong>
                        <span>
                          {localCliStatusText(provider, localCliConnection)}
                        </span>
                      </div>
                      {localCliNote ? (
                        <p className="provider-connection-note">
                          {localCliNote}
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div className="settings-actions">
          <button className="ghost-button" onClick={onClose} type="button">
            Cancel
          </button>
          <button
            className="primary-button"
            onClick={() => onSave(draft)}
            type="button"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
