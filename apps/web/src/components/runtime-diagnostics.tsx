import type { RuntimeInfo } from '@raincheck/contracts'

type RuntimeDiagnosticsProps = {
  visible: boolean
  apiTarget: string
  runtimeInfo: RuntimeInfo | null
}

function compactTarget(value: string) {
  if (value.startsWith('/')) {
    return value
  }

  try {
    const url = new URL(value)
    const path = url.pathname === '/' ? '' : url.pathname
    return `${url.origin}${path}`
  } catch {
    return value
  }
}

export function RuntimeDiagnostics({
  visible,
  apiTarget,
  runtimeInfo,
}: RuntimeDiagnosticsProps) {
  if (!visible) {
    return null
  }

  return (
    <output aria-live="polite" className="thread-runtime-bar">
      <span className="thread-runtime-chip">
        API {compactTarget(apiTarget)}
      </span>
      <span className="thread-runtime-chip">
        Runtime {runtimeInfo?.runtimeId ?? 'waiting'}
      </span>
      <span className="thread-runtime-chip">
        Weather{' '}
        {runtimeInfo ? compactTarget(runtimeInfo.weatherServiceUrl) : 'waiting'}
      </span>
    </output>
  )
}
