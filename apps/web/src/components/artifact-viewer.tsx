import { X } from 'lucide-react'
import { resolveApiUrl } from '../lib/api'

type ArtifactViewerProps = {
  artifact?: {
    href: string
    title: string
    mimeType: string
    imageAlt?: string
  } | null
  onClose: () => void
}

export function ArtifactViewer({ artifact, onClose }: ArtifactViewerProps) {
  if (!artifact) {
    return null
  }

  const artifactUrl = resolveApiUrl(artifact.href)

  return (
    /* biome-ignore lint/a11y/noStaticElementInteractions: modal backdrop closes the viewer when the backdrop itself is clicked */
    <div
      className="artifact-viewer-backdrop"
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
      <div aria-modal="true" className="artifact-viewer-panel" role="dialog">
        <div className="artifact-viewer-header">
          <div>
            <p className="sidebar-brand">{artifact.title}</p>
            <p className="sidebar-caption">{artifact.mimeType}</p>
          </div>
          <button className="ghost-icon-button" onClick={onClose} type="button">
            <X size={18} />
          </button>
        </div>
        {artifact.mimeType.includes('image') ? (
          <img
            alt={artifact.imageAlt ?? artifact.title}
            className="artifact-media"
            src={artifactUrl}
          />
        ) : (
          <iframe
            className="artifact-frame"
            src={artifactUrl}
            title={artifact.title}
          />
        )}
      </div>
    </div>
  )
}
