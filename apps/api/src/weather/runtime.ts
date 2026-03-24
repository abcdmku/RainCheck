import type { Citation } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { AppError } from '../lib/errors'
import { fetchJson, fetchText } from '../lib/http'
import { nowIso } from '../lib/time'

type CacheEntry = {
  expiresAt: number
  value: unknown
}

const weatherCache = new Map<string, CacheEntry>()

export type WeatherSourceTag = {
  sourceId: string
  productId: string
  label: string
  url: string
}

export type WeatherFetchTarget = WeatherSourceTag & {
  cacheKey?: string
  ttlMs?: number
  retries?: number
}

export type WeatherArtifactHandle = {
  artifactId: string
  type: string
  title: string
  href: string
  mimeType: string
}

export type WeatherLocationSummary = {
  query: string
  name: string
  latitude: number
  longitude: number
  region?: string
  country?: string
  resolvedBy: string
}

export type WeatherEnvelope<TData> = {
  sourceId: string
  sourceName: string
  retrievedAt: string
  validAt?: string
  validRange?: {
    start: string
    end: string
  }
  location: WeatherLocationSummary
  units: Record<string, string>
  confidence: number
  summary: string
  data: TData
  citations: Array<Citation>
  artifacts?: Array<WeatherArtifactHandle>
}

export type WeatherFetchResult<T> = {
  value: T
  source: WeatherSourceTag
  retrievedAt: string
  cached: boolean
}

type FetchFailure = {
  sourceId: string
  productId: string
  message: string
}

function normalizeKeyPart(value: string | number | boolean | null | undefined) {
  return value == null ? '' : String(value)
}

export function cacheKey(...parts: Array<string | number | boolean | null | undefined>) {
  return parts.map(normalizeKeyPart).filter(Boolean).join(':')
}

export function clearWeatherCache() {
  weatherCache.clear()
}

function readCache<T>(key: string) {
  const entry = weatherCache.get(key)
  if (!entry) {
    return null
  }

  if (entry.expiresAt <= Date.now()) {
    weatherCache.delete(key)
    return null
  }

  return entry.value as T
}

function readStaleCache<T>(key: string) {
  const entry = weatherCache.get(key)
  if (!entry) {
    return null
  }

  return entry.value as T
}

function writeCache<T>(key: string, value: T, ttlMs: number) {
  weatherCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  })
}

async function withRetry<T>(handler: () => Promise<T>, retries: number) {
  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await handler()
    } catch (error) {
      lastError = error
      if (attempt < retries) {
        await new Promise((resolve) =>
          setTimeout(resolve, 150 * (attempt + 1)),
        )
      }
    }
  }

  throw lastError
}

function sourceCitation(source: WeatherSourceTag, retrievedAt: string, note?: string) {
  return {
    id: `${source.sourceId}:${source.productId}`,
    label: source.label,
    sourceId: source.sourceId,
    productId: source.productId,
    url: source.url,
    issuedAt: retrievedAt,
    note,
  } satisfies Citation
}

export function buildWeatherEnvelope<TData>(input: {
  source: WeatherSourceTag
  location: WeatherLocationSummary
  units: string | Record<string, string>
  summary: string
  data: TData
  confidence?: number
  validAt?: string
  validRange?: {
    start: string
    end: string
  }
  citations?: Array<Citation>
  artifacts?: Array<WeatherArtifactHandle>
  retrievedAt?: string
}) {
  const retrievedAt = input.retrievedAt ?? nowIso()
  const units =
    typeof input.units === 'string'
      ? { defaultUnit: input.units }
      : input.units

  return {
    sourceId: input.source.sourceId,
    sourceName: input.source.label,
    retrievedAt,
    validAt: input.validAt ?? input.validRange?.start ?? retrievedAt,
    validRange: input.validRange,
    location: input.location,
    units,
    confidence: input.confidence ?? 0.75,
    summary: input.summary,
    data: input.data,
    citations: input.citations ?? [sourceCitation(input.source, retrievedAt)],
    artifacts: input.artifacts,
  } satisfies WeatherEnvelope<TData>
}

export async function fetchWeatherJson<T>(
  app: FastifyInstance,
  target: WeatherFetchTarget,
  options: {
    ttlMs?: number
    allowStale?: boolean
    requestInit?: RequestInit
  } = {},
): Promise<WeatherFetchResult<T>> {
  const ttlMs = options.ttlMs ?? target.ttlMs ?? 5 * 60 * 1000
  const cacheName = target.cacheKey ?? cacheKey(target.sourceId, target.productId, target.url)
  const cached = readCache<T>(cacheName)
  if (cached) {
    return {
      value: cached,
      source: target,
      retrievedAt: nowIso(),
      cached: true,
    }
  }

  const fetcher = () =>
    fetchJson<T>(app.raincheckEnv, target.url, options.requestInit)
  try {
    const value = await withRetry(fetcher, target.retries ?? 1)
    writeCache(cacheName, value, ttlMs)
    return {
      value,
      source: target,
      retrievedAt: nowIso(),
      cached: false,
    }
  } catch (error) {
    const stale = options.allowStale !== false ? readStaleCache<T>(cacheName) : null
    if (stale) {
      return {
        value: stale,
        source: target,
        retrievedAt: nowIso(),
        cached: true,
      }
    }

    throw new AppError(
      502,
      'weather_source_unavailable',
      `Weather source ${target.sourceId}:${target.productId} could not be reached.`,
      {
        url: target.url,
        sourceId: target.sourceId,
        productId: target.productId,
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

export async function fetchWeatherText(
  app: FastifyInstance,
  target: WeatherFetchTarget,
  options: {
    ttlMs?: number
    allowStale?: boolean
    requestInit?: RequestInit
  } = {},
): Promise<WeatherFetchResult<string>> {
  const ttlMs = options.ttlMs ?? target.ttlMs ?? 5 * 60 * 1000
  const cacheName = target.cacheKey ?? cacheKey(target.sourceId, target.productId, target.url)
  const cached = readCache<string>(cacheName)
  if (cached) {
    return {
      value: cached,
      source: target,
      retrievedAt: nowIso(),
      cached: true,
    }
  }

  const fetcher = () =>
    fetchText(app.raincheckEnv, target.url, options.requestInit)
  try {
    const value = await withRetry(fetcher, target.retries ?? 1)
    writeCache(cacheName, value, ttlMs)
    return {
      value,
      source: target,
      retrievedAt: nowIso(),
      cached: false,
    }
  } catch (error) {
    const stale = options.allowStale !== false ? readStaleCache<string>(cacheName) : null
    if (stale) {
      return {
        value: stale,
        source: target,
        retrievedAt: nowIso(),
        cached: true,
      }
    }

    throw new AppError(
      502,
      'weather_source_unavailable',
      `Weather source ${target.sourceId}:${target.productId} could not be reached.`,
      {
        url: target.url,
        sourceId: target.sourceId,
        productId: target.productId,
        error: error instanceof Error ? error.message : String(error),
      },
    )
  }
}

export async function fetchWeatherJsonCandidates<T>(
  app: FastifyInstance,
  targets: Array<WeatherFetchTarget>,
  options: {
    ttlMs?: number
    allowStale?: boolean
    requestInit?: RequestInit
  } = {},
): Promise<WeatherFetchResult<T>> {
  const failures: Array<FetchFailure> = []

  for (const target of targets) {
    try {
      return await fetchWeatherJson<T>(app, target, options)
    } catch (error) {
      failures.push({
        sourceId: target.sourceId,
        productId: target.productId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  throw new AppError(
    502,
    'weather_source_fallback_failed',
    'All candidate weather sources failed.',
    {
      failures,
    },
  )
}

export async function fetchWeatherTextCandidates(
  app: FastifyInstance,
  targets: Array<WeatherFetchTarget>,
  options: {
    ttlMs?: number
    allowStale?: boolean
    requestInit?: RequestInit
  } = {},
): Promise<WeatherFetchResult<string>> {
  const failures: Array<FetchFailure> = []

  for (const target of targets) {
    try {
      return await fetchWeatherText(app, target, options)
    } catch (error) {
      failures.push({
        sourceId: target.sourceId,
        productId: target.productId,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  throw new AppError(
    502,
    'weather_source_fallback_failed',
    'All candidate weather sources failed.',
    {
      failures,
    },
  )
}

export function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

export function stripHtml(value: string) {
  return normalizeWhitespace(
    value
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
}

export function extractHtmlTitle(value: string) {
  const match = value.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!match?.[1]) {
    return null
  }

  return normalizeWhitespace(match[1])
}

export function summarizeText(value: string, maxChars = 280) {
  const cleaned = normalizeWhitespace(value)
  if (cleaned.length <= maxChars) {
    return cleaned
  }

  const cutoff = cleaned.slice(0, maxChars)
  const sentenceEnd = Math.max(
    cutoff.lastIndexOf('.'),
    cutoff.lastIndexOf('!'),
    cutoff.lastIndexOf('?'),
  )
  if (sentenceEnd > 120) {
    return cutoff.slice(0, sentenceEnd + 1)
  }

  return `${cutoff.trimEnd()}...`
}

export function firstNonEmptyLine(value: string) {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  )
}
