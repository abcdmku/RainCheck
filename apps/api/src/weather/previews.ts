import type { WeatherArtifactHandle } from './runtime'

export type WeatherPreviewFields = {
  thumbnailUrl?: string
  imageAlt?: string
  previewArtifactId?: string
  fullArtifactId?: string
  severity?: string
}

export function absoluteUrl(baseUrl: string, value: string | undefined | null) {
  if (!value) {
    return undefined
  }

  if (/^https?:\/\//i.test(value)) {
    return value
  }

  if (value.startsWith('//')) {
    return `https:${value}`
  }

  return new URL(value, baseUrl).toString()
}

export function mergeArtifacts(
  ...groups: Array<Array<WeatherArtifactHandle> | undefined>
) {
  const artifacts = new Map<string, WeatherArtifactHandle>()

  for (const group of groups) {
    for (const artifact of group ?? []) {
      artifacts.set(artifact.artifactId, artifact)
    }
  }

  return [...artifacts.values()]
}

export function previewFromArtifact(
  artifact: WeatherArtifactHandle,
  imageAlt: string,
  options: {
    previewArtifactId?: string
    fullArtifactId?: string
    thumbnailUrl?: string
    severity?: string
  } = {},
): WeatherPreviewFields {
  return {
    thumbnailUrl: options.thumbnailUrl ?? artifact.href,
    imageAlt,
    previewArtifactId: options.previewArtifactId ?? artifact.artifactId,
    fullArtifactId: options.fullArtifactId ?? artifact.artifactId,
    severity: options.severity,
  }
}
