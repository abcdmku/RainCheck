export type ThemeMode = 'dark' | 'light' | 'system'

export function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const resolved = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode
  root.classList.remove('light', 'dark')
  root.classList.add(resolved)
  root.dataset.theme = mode
  root.style.colorScheme = resolved
}

export function loadTheme() {
  if (typeof window === 'undefined') {
    return 'dark' as ThemeMode
  }

  const stored = window.localStorage.getItem('raincheck-theme')
  if (stored === 'dark' || stored === 'light' || stored === 'system') {
    return stored
  }

  return 'dark' as ThemeMode
}
