export type ChatLocationOverride = {
  label: string
  latitude?: number
  longitude?: number
  timezone?: string
}

export type StoredLocationPreference =
  | {
      mode: 'custom'
      value: ChatLocationOverride
    }
  | {
      mode: 'cleared'
    }

const storedLocationPreferenceKey = 'raincheck:location-preference'

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value)
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function normalizeLocationOverride(
  value: unknown,
): ChatLocationOverride | null {
  if (!isRecord(value) || typeof value.label !== 'string') {
    return null
  }

  const label = value.label.trim()
  if (!label) {
    return null
  }

  return {
    label,
    latitude: isFiniteNumber(value.latitude) ? value.latitude : undefined,
    longitude: isFiniteNumber(value.longitude) ? value.longitude : undefined,
    timezone:
      typeof value.timezone === 'string' && value.timezone.trim()
        ? value.timezone.trim()
        : undefined,
  }
}

export function loadStoredLocationPreference(): StoredLocationPreference | null {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(storedLocationPreferenceKey)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw)
    if (isRecord(parsed) && parsed.mode === 'cleared') {
      return {
        mode: 'cleared',
      }
    }

    if (isRecord(parsed) && parsed.mode === 'custom') {
      const value = normalizeLocationOverride(parsed.value)
      if (value) {
        return {
          mode: 'custom',
          value,
        }
      }
    }
  } catch {
    window.localStorage.removeItem(storedLocationPreferenceKey)
  }

  return null
}

export function saveStoredLocationPreference(
  value: StoredLocationPreference | null,
) {
  if (typeof window === 'undefined') {
    return
  }

  if (!value || value.mode === 'cleared') {
    window.localStorage.removeItem(storedLocationPreferenceKey)
    return
  }

  window.localStorage.setItem(
    storedLocationPreferenceKey,
    JSON.stringify(value),
  )
}
