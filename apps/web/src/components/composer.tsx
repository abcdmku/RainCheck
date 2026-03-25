import {
  ChevronDown,
  LoaderCircle,
  MapPin,
  Navigation,
  Plus,
  SendHorizontal,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChatLocationOverride } from '../lib/location'
import type { ModelOption } from '../lib/model-options'

/* ── Tool category definitions ───────────────── */

type ToolCategory = {
  label: string
  tools: Array<{ name: string; description: string }>
}

const toolCategories: Array<ToolCategory> = [
  {
    label: 'Core',
    tools: [
      { name: 'resolve_location', description: 'Location resolution' },
      { name: 'get_current_conditions', description: 'Current conditions' },
      { name: 'get_forecast', description: 'Forecast' },
      { name: 'get_alerts', description: 'Active alerts' },
    ],
  },
  {
    label: 'Severe & Fire',
    tools: [
      { name: 'get_spc_severe_products', description: 'SPC severe' },
      { name: 'get_fire_weather_products', description: 'Fire weather' },
    ],
  },
  {
    label: 'Precipitation',
    tools: [
      { name: 'get_wpc_qpf_ero', description: 'QPF & ERO' },
      { name: 'get_wpc_winter_weather', description: 'Winter weather' },
      {
        name: 'get_wpc_medium_range_hazards',
        description: 'Medium-range hazards',
      },
    ],
  },
  {
    label: 'Remote Sensing',
    tools: [
      { name: 'get_nexrad_radar', description: 'NEXRAD radar' },
      { name: 'get_goes_satellite', description: 'GOES satellite' },
      { name: 'get_mrms_products', description: 'MRMS products' },
    ],
  },
  {
    label: 'Model Guidance',
    tools: [
      { name: 'get_short_range_model_guidance', description: 'Short-range' },
      {
        name: 'get_blend_and_analysis_guidance',
        description: 'Blend & analysis',
      },
      { name: 'get_global_model_guidance', description: 'Global models' },
      { name: 'compare_models', description: 'Compare models' },
    ],
  },
  {
    label: 'Specialized',
    tools: [
      { name: 'get_aviation_weather', description: 'Aviation' },
      { name: 'get_hydrology_nwps', description: 'Hydrology' },
      { name: 'get_tropical_weather', description: 'Tropical' },
      { name: 'get_marine_ocean_guidance', description: 'Marine & ocean' },
      { name: 'get_upper_air_soundings', description: 'Upper-air soundings' },
      { name: 'get_historical_climate', description: 'Historical climate' },
      { name: 'get_storm_history', description: 'Storm history' },
    ],
  },
]

/* ── Reasoning levels ────────────────────────── */

export type ReasoningLevel = 'none' | 'low' | 'medium' | 'high'

const reasoningLevels: Array<{ id: ReasoningLevel; label: string }> = [
  { id: 'none', label: 'None' },
  { id: 'low', label: 'Low' },
  { id: 'medium', label: 'Medium' },
  { id: 'high', label: 'High' },
]

/* ── Props ───────────────────────────────────── */

type ComposerProps = {
  value: string
  isLoading: boolean
  onChange: (next: string) => void
  onSubmit: () => void
  modelOptions: Array<ModelOption>
  selectedModel: ModelOption | null
  onModelChange: (option: ModelOption) => void
  reasoningLevel: ReasoningLevel
  onReasoningLevelChange: (level: ReasoningLevel) => void
  locationLabel: string | null
  onLocationChange: (location: ChatLocationOverride | null) => void
  canAutoDetectLocation: boolean
  messageHistory: Array<string>
}

/* ── Reverse geocode helper ──────────────────── */

async function reverseGeocode(lat: number, lon: number): Promise<string> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&addressdetails=1`,
      { headers: { 'User-Agent': 'RainCheck/1.0' } },
    )
    if (!response.ok) throw new Error('geocode failed')
    const data = await response.json()
    const addr = data.address ?? {}
    const city =
      addr.city ?? addr.town ?? addr.village ?? addr.hamlet ?? addr.county ?? ''
    const state = addr.state ?? ''
    if (city && state) return `${city}, ${state}`
    if (city) return city
    if (state) return state
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
  } catch {
    return `${lat.toFixed(4)}, ${lon.toFixed(4)}`
  }
}

/* ── Fixed-position popover ──────────────────── */

function FixedPopover({
  anchorRef,
  align,
  children,
  onClose,
}: {
  anchorRef: React.RefObject<HTMLButtonElement | null>
  align: 'left' | 'right'
  children: React.ReactNode
  onClose: () => void
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({
    position: 'fixed',
    visibility: 'hidden',
  })

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return

    function reposition() {
      const rect = anchor!.getBoundingClientRect()
      const popover = popoverRef.current
      const popoverWidth = popover?.offsetWidth ?? 300
      const newStyle: React.CSSProperties = {
        position: 'fixed',
        bottom: window.innerHeight - rect.top + 8,
        visibility: 'visible',
      }
      if (align === 'right') {
        newStyle.right = window.innerWidth - rect.right
      } else {
        // Clamp so it doesn't go off-screen right
        const leftPos = rect.left
        const maxLeft = window.innerWidth - popoverWidth - 12
        newStyle.left = Math.min(leftPos, maxLeft)
      }
      setStyle(newStyle)
    }

    reposition()
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [anchorRef, align])

  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (
        anchor &&
        !anchor.contains(event.target as Node) &&
        popover &&
        !popover.contains(event.target as Node)
      ) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [anchorRef, onClose])

  return createPortal(
    <div className="popover-menu" ref={popoverRef} style={style}>
      {children}
    </div>,
    document.body,
  )
}

/* ── Composer ────────────────────────────────── */

export function Composer({
  value,
  isLoading,
  onChange,
  onSubmit,
  modelOptions,
  selectedModel,
  onModelChange,
  reasoningLevel,
  onReasoningLevelChange,
  locationLabel,
  onLocationChange,
  canAutoDetectLocation,
  messageHistory,
}: ComposerProps) {
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [locationMenuOpen, setLocationMenuOpen] = useState(false)
  const [locationSearch, setLocationSearch] = useState('')
  const [geoStatus, setGeoStatus] = useState<'idle' | 'loading' | 'error'>(
    'idle',
  )
  const [historyIndex, setHistoryIndex] = useState(-1)

  const toolsBtnRef = useRef<HTMLButtonElement>(null)
  const modelChipRef = useRef<HTMLButtonElement>(null)
  const locationBtnRef = useRef<HTMLButtonElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const locationInputRef = useRef<HTMLInputElement>(null)

  /* ── Auto-focus location input ─────────────── */

  useEffect(() => {
    if (locationMenuOpen && locationInputRef.current) {
      locationInputRef.current.focus()
    }
  }, [locationMenuOpen])

  /* ── Auto-resize textarea ──────────────────── */

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`
    }
  }, [value])

  /* ── Geolocation ───────────────────────────── */

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setGeoStatus('error')
      return
    }
    setGeoStatus('loading')
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        const fallbackLabel = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
        onLocationChange({
          label: fallbackLabel,
          latitude,
          longitude,
        })

        try {
          const label = await reverseGeocode(latitude, longitude)
          onLocationChange({
            label,
            latitude,
            longitude,
          })
          setGeoStatus('idle')
          setLocationMenuOpen(false)
        } catch {
          setGeoStatus('idle')
        }
      },
      () => setGeoStatus('error'),
      { timeout: 10000 },
    )
  }, [onLocationChange])

  /* ── Auto-detect on mount if no location set ─ */

  useEffect(() => {
    if (canAutoDetectLocation && !locationLabel) {
      detectLocation()
    }
  }, [canAutoDetectLocation, detectLocation, locationLabel])

  /* ── Keyboard handler ──────────────────────── */

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      onSubmit()
      setHistoryIndex(-1)
      return
    }

    if (event.key === 'ArrowUp' && value === '') {
      event.preventDefault()
      if (messageHistory.length === 0) return
      const nextIndex =
        historyIndex < messageHistory.length - 1
          ? historyIndex + 1
          : historyIndex
      setHistoryIndex(nextIndex)
      onChange(messageHistory[nextIndex])
      return
    }

    if (event.key === 'ArrowDown' && historyIndex >= 0) {
      event.preventDefault()
      const nextIndex = historyIndex - 1
      setHistoryIndex(nextIndex)
      onChange(nextIndex >= 0 ? messageHistory[nextIndex] : '')
    }
  }

  /* ── Location submit ───────────────────────── */

  function submitLocationSearch() {
    const trimmed = locationSearch.trim()
    if (trimmed) {
      onLocationChange({
        label: trimmed,
      })
      setLocationSearch('')
      setLocationMenuOpen(false)
    }
  }

  return (
    <div className="composer-shell">
      <div className="composer-surface">
        <textarea
          ref={textareaRef}
          aria-label="Ask RainCheck about the weather"
          className="composer-input"
          onChange={(event) => {
            onChange(event.target.value)
            setHistoryIndex(-1)
          }}
          onKeyDown={handleKeyDown}
          placeholder="Ask about weather anywhere..."
          rows={1}
          value={value}
        />

        <div className="composer-toolbar">
          {/* ── Left side: + (tools), model chip, reasoning chip */}
          <div className="composer-toolbar-left">
            <button
              ref={toolsBtnRef}
              aria-label="Tools"
              className={`composer-icon-btn${toolsMenuOpen ? ' is-active' : ''}`}
              onClick={() => {
                setToolsMenuOpen((p) => !p)
                setModelMenuOpen(false)
                setLocationMenuOpen(false)
              }}
              type="button"
            >
              <Plus size={16} />
            </button>

            <button
              ref={modelChipRef}
              className={`composer-chip${modelMenuOpen ? ' is-active' : ''}`}
              onClick={() => {
                setModelMenuOpen((p) => !p)
                setToolsMenuOpen(false)
                setLocationMenuOpen(false)
              }}
              type="button"
            >
              {selectedModel ? (
                <>
                  <span className="composer-chip-icon">&#10070;</span>
                  {selectedModel.label}
                </>
              ) : (
                'No model'
              )}
              <ChevronDown size={12} />
            </button>

            {reasoningLevel !== 'none' ? (
              <button
                className={`composer-chip${modelMenuOpen ? ' is-active' : ''}`}
                onClick={() => {
                  setModelMenuOpen((p) => !p)
                  setToolsMenuOpen(false)
                  setLocationMenuOpen(false)
                }}
                type="button"
              >
                {reasoningLevel.charAt(0).toUpperCase() +
                  reasoningLevel.slice(1)}
                <ChevronDown size={12} />
              </button>
            ) : null}
          </div>

          {/* ── Right side: location, send */}
          <div className="composer-toolbar-right">
            <button
              ref={locationBtnRef}
              className={`composer-chip composer-location-chip${locationMenuOpen ? ' is-active' : ''}`}
              onClick={() => {
                setLocationMenuOpen((p) => !p)
                setToolsMenuOpen(false)
                setModelMenuOpen(false)
              }}
              type="button"
            >
              <MapPin size={12} />
              {locationLabel || 'Set location'}
              <ChevronDown size={12} />
            </button>

            <button
              className="composer-send-btn"
              disabled={isLoading || value.trim().length === 0}
              onClick={() => {
                onSubmit()
                setHistoryIndex(-1)
              }}
              type="button"
            >
              {isLoading ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <SendHorizontal size={16} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* ── Tools popover (+ button) ──────────────── */}
      {toolsMenuOpen ? (
        <FixedPopover
          align="left"
          anchorRef={toolsBtnRef}
          onClose={() => setToolsMenuOpen(false)}
        >
          <div className="popover-section popover-tools-section">
            <p className="popover-section-label">Tools</p>
            <div className="popover-tools-list">
              {toolCategories.map((category) => (
                <div className="popover-tool-group" key={category.label}>
                  <p className="popover-tool-group-label">{category.label}</p>
                  {category.tools.map((tool) => (
                    <div className="popover-tool-row" key={tool.name}>
                      <span className="popover-tool-dot" />
                      <span className="popover-tool-name">
                        {tool.description}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </FixedPopover>
      ) : null}

      {/* ── Model & reasoning popover (model chip) ── */}
      {modelMenuOpen ? (
        <FixedPopover
          align="left"
          anchorRef={modelChipRef}
          onClose={() => setModelMenuOpen(false)}
        >
          <div className="popover-section">
            <p className="popover-section-label">Model</p>
            <div className="popover-model-list">
              {modelOptions.map((option) => (
                <button
                  className={`popover-model-item${selectedModel?.id === option.id ? ' is-selected' : ''}`}
                  key={`${option.provider}:${option.model}`}
                  onClick={() => {
                    onModelChange(option)
                    setModelMenuOpen(false)
                  }}
                  type="button"
                >
                  <span className="popover-model-name">{option.label}</span>
                  <span className="popover-model-provider">
                    {option.providerLabel}
                  </span>
                </button>
              ))}
              {modelOptions.length === 0 ? (
                <p className="popover-empty">No providers configured</p>
              ) : null}
            </div>
          </div>

          <div className="popover-section">
            <p className="popover-section-label">Reasoning</p>
            <div className="popover-reasoning-row">
              {reasoningLevels.map((level) => (
                <button
                  className={`popover-reasoning-chip${reasoningLevel === level.id ? ' is-selected' : ''}`}
                  key={level.id}
                  onClick={() => onReasoningLevelChange(level.id)}
                  type="button"
                >
                  {level.label}
                </button>
              ))}
            </div>
          </div>
        </FixedPopover>
      ) : null}

      {/* ── Location popover (portaled to body) ── */}
      {locationMenuOpen ? (
        <FixedPopover
          align="right"
          anchorRef={locationBtnRef}
          onClose={() => setLocationMenuOpen(false)}
        >
          <div className="popover-section">
            <p className="popover-section-label">Location</p>

            <button
              className="popover-detect-btn"
              disabled={geoStatus === 'loading'}
              onClick={detectLocation}
              type="button"
            >
              <Navigation size={14} />
              {geoStatus === 'loading'
                ? 'Detecting...'
                : 'Use current location'}
            </button>

            {geoStatus === 'error' ? (
              <p className="popover-geo-error">
                Unable to detect location. Enter manually below.
              </p>
            ) : null}

            <div className="popover-location-input-row">
              <input
                ref={locationInputRef}
                className="popover-location-input"
                onChange={(event) => setLocationSearch(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    submitLocationSearch()
                  }
                }}
                placeholder="City, ZIP, or coordinates..."
                type="text"
                value={locationSearch}
              />
            </div>

            {locationLabel ? (
              <div className="popover-current-location">
                <MapPin size={12} />
                <span>{locationLabel}</span>
                <button
                  aria-label="Clear location"
                  className="popover-clear-btn"
                  onClick={() => {
                    onLocationChange(null)
                    setLocationMenuOpen(false)
                  }}
                  type="button"
                >
                  <X size={12} />
                </button>
              </div>
            ) : null}
          </div>
        </FixedPopover>
      ) : null}
    </div>
  )
}
