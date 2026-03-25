import fs from 'node:fs/promises'
import path from 'node:path'
import { forecastSummarySchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { resolveWorkspacePath } from '../lib/paths'
import { nowIso } from '../lib/time'
import { getForecast } from './nws'

type BaseArtifactType =
  | 'meteogram'
  | 'research-report'
  | 'radar-loop'
  | 'satellite-loop'
  | 'hydrograph'
  | 'skewt'
  | 'rainfall-chart'
  | 'snowfall-chart'
  | 'brief-report'

type ArtifactChartPoint = {
  label: string
  value: number
}

type ArtifactChartSeries = {
  label: string
  points: Array<ArtifactChartPoint>
  color?: string
}

type ArtifactLoopFrame = {
  label: string
  timestamp?: string
  description?: string
  imageUrl?: string
}

type ArtifactSoundingLevel = {
  pressureHpa: number
  temperatureC?: number
  dewpointC?: number
  windSpeedKt?: number
  windDirectionDeg?: number
}

type ArtifactOptions = {
  artifactType: BaseArtifactType
  locationQuery: string
  prompt: string
  chartPoints?: Array<ArtifactChartPoint>
  chartSeries?: Array<ArtifactChartSeries>
  frames?: Array<ArtifactLoopFrame>
  soundingLevels?: Array<ArtifactSoundingLevel>
  thresholds?: Array<ArtifactChartPoint>
  sections?: Array<string>
}

function resolveArtifactsDir(app: FastifyInstance) {
  return resolveWorkspacePath(app.raincheckEnv.ARTIFACTS_DIR)
}

function artifactHref(id: string) {
  return `/api/artifacts/${id}`
}

async function writeArtifactFile(
  app: FastifyInstance,
  name: string,
  contents: string,
) {
  const dir = resolveArtifactsDir(app)
  await fs.mkdir(dir, { recursive: true })
  const filePath = path.join(dir, name)
  await fs.writeFile(filePath, contents, 'utf8')
  return filePath
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export async function checkWeatherService(app: FastifyInstance) {
  try {
    const response = await fetch(
      `${app.raincheckEnv.WEATHER_SERVICE_URL}/health`,
    )
    return response.ok
  } catch {
    return false
  }
}

async function loadMeteogramForecast(
  app: FastifyInstance,
  locationQuery: string,
) {
  return forecastSummarySchema.parse(
    await getForecast(app, locationQuery, 'short'),
  )
}

function buildMeteogramChartPoints(
  forecast: Awaited<ReturnType<typeof loadMeteogramForecast>>,
) {
  return forecast.periods.slice(0, 6).map((period) => ({
    label: period.name,
    value: period.temperature,
  }))
}

function buildMeteogramPath(
  forecast: Awaited<ReturnType<typeof loadMeteogramForecast>>,
) {
  return buildMeteogramChartPoints(forecast)
    .map((point, index) => {
      const x = 40 + index * 100
      const y = 180 - (point.value - 30) * 2
      return `${index === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')
}

function buildStandaloneChartSvg(
  title: string,
  subtitle: string,
  footer: string,
  points: Array<{ label: string; value: number }>,
  accent: string,
) {
  const minValue = Math.min(...points.map((point) => point.value))
  const maxValue = Math.max(...points.map((point) => point.value))
  const span = Math.max(maxValue - minValue, 1)
  const pathData = points
    .map((point, index) => {
      const x = 60 + index * 90
      const y = 210 - ((point.value - minValue) / span) * 120
      return `${index === 0 ? 'M' : 'L'}${x},${y}`
    })
    .join(' ')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="280" viewBox="0 0 720 280">
    <rect width="720" height="280" rx="22" fill="#091419" />
    <text x="32" y="38" fill="#eef5f5" font-family="sans-serif" font-size="20">${escapeHtml(title)}</text>
    <text x="32" y="60" fill="#9ab2b6" font-family="sans-serif" font-size="12">${escapeHtml(subtitle)}</text>
    <path d="${pathData}" fill="none" stroke="${accent}" stroke-width="5" stroke-linecap="round" />
    ${points
      .map((point, index) => {
        const x = 60 + index * 90
        const y = 210 - ((point.value - minValue) / span) * 120
        return `<circle cx="${x}" cy="${y}" r="4" fill="${accent}" />`
      })
      .join('')}
    ${points
      .map((point, index) => {
        const x = 36 + index * 90
        return `<text x="${x}" y="240" fill="#9ab2b6" font-size="11" font-family="sans-serif">${escapeHtml(point.label)}</text>`
      })
      .join('')}
    <text x="32" y="262" fill="#7f999e" font-family="sans-serif" font-size="11">${escapeHtml(footer)}</text>
  </svg>`
}

function buildInfoSvg(
  title: string,
  subtitle: string,
  lines: Array<string>,
  accent: string,
) {
  const lineEls = lines
    .slice(0, 5)
    .map((line, index) => {
      return `<text x="28" y="${118 + index * 24}" fill="#b9c9cb" font-family="sans-serif" font-size="14">${escapeHtml(line)}</text>`
    })
    .join('')

  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <style>
        body { margin: 0; background: #091419; color: #f5f7f8; font-family: ui-sans-serif, system-ui, sans-serif; }
        main { max-width: 860px; margin: 0 auto; padding: 28px; }
        .panel { background: #0d1519; border: 1px solid #19303a; border-radius: 18px; padding: 20px; }
      </style>
    </head>
    <body>
      <main>
        <section class="panel">
          <div style="color:${accent};text-transform:uppercase;letter-spacing:.14em;font-size:12px">${escapeHtml(title)}</div>
          <h1 style="margin:8px 0 4px;font-size:28px">${escapeHtml(title)}</h1>
          <p style="color:#9ab2b6;line-height:1.6">${escapeHtml(subtitle)}</p>
          <svg xmlns="http://www.w3.org/2000/svg" width="800" height="240" viewBox="0 0 800 240">
            <rect width="800" height="240" rx="18" fill="#0b1317" />
            <path d="M40 56h720" stroke="${accent}" stroke-width="2" stroke-dasharray="6 6" />
            ${lineEls}
          </svg>
        </section>
      </main>
    </body>
  </html>`
}

function buildReportHtml(
  title: string,
  locationQuery: string,
  prompt: string,
  bullets: Array<string>,
) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>${escapeHtml(title)}</title>
      <style>
        body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0b1317; color: #edf3f3; }
        main { max-width: 760px; margin: 0 auto; padding: 48px 24px 72px; }
        h1 { margin: 0 0 8px; font-size: 32px; }
        p, li { color: #b9c9cb; line-height: 1.6; }
        .eyebrow { text-transform: uppercase; letter-spacing: 0.14em; font-size: 12px; color: #78d7cb; }
      </style>
    </head>
    <body>
      <main>
        <div class="eyebrow">${escapeHtml(title)}</div>
        <h1>${escapeHtml(locationQuery)}</h1>
        <p>Generated at ${nowIso()}</p>
        <p>${escapeHtml(prompt)}</p>
        <ul>
          ${bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}
        </ul>
      </main>
    </body>
  </html>`
}

function buildMeteogramFallback(app: FastifyInstance, forecast: Awaited<ReturnType<typeof loadMeteogramForecast>>) {
  const points = buildMeteogramPath(forecast)
  const artifactId = `meteogram-${Date.now()}.svg`
  return writeArtifactFile(
    app,
    artifactId,
    `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="240" viewBox="0 0 680 240">
      <rect width="680" height="240" fill="#0d1519" rx="18"/>
      <path d="${points}" fill="none" stroke="#6dd6cb" stroke-width="4"/>
      <text x="28" y="36" fill="#f5f7f8" font-family="sans-serif" font-size="18">RainCheck Meteogram</text>
      <text x="28" y="60" fill="#9ab2b6" font-family="sans-serif" font-size="12">${escapeHtml(forecast.location.name)}</text>
    </svg>`,
  ).then(() => ({
    artifactId,
    type: 'meteogram',
    title: `Meteogram for ${forecast.location.name}`,
    href: artifactHref(artifactId),
    mimeType: 'image/svg+xml',
  }))
}

function resolveChartPoints(
  options: ArtifactOptions,
  forecast: Awaited<ReturnType<typeof loadMeteogramForecast>>,
) {
  return options.chartPoints?.length
    ? options.chartPoints
    : buildMeteogramChartPoints(forecast)
}

function buildGenericChartFallback(
  app: FastifyInstance,
  artifactType: Exclude<BaseArtifactType, 'meteogram' | 'research-report' | 'brief-report' | 'radar-loop' | 'satellite-loop' | 'skewt'>,
  options: ArtifactOptions,
  forecast: Awaited<ReturnType<typeof loadMeteogramForecast>>,
) {
  const points = resolveChartPoints(options, forecast)
  const palette: Record<string, string> = {
    'rainfall-chart': '#63c8ff',
    'snowfall-chart': '#d4e6ff',
    hydrograph: '#7be0be',
  }
  const titleMap: Record<string, string> = {
    'rainfall-chart': 'RainCheck Rainfall Chart',
    'snowfall-chart': 'RainCheck Snowfall Chart',
    hydrograph: 'RainCheck Hydrograph',
  }
  const artifactId = `${artifactType}-${Date.now()}.svg`
  return writeArtifactFile(
    app,
    artifactId,
    buildStandaloneChartSvg(
      titleMap[artifactType],
      `${options.locationQuery} | ${options.prompt}`,
      artifactType === 'hydrograph'
        ? 'Observed and forecast river trends remain summarized until richer gauge panels are wired in.'
        : 'Generated from RainCheck fallback chart points.',
      points,
      palette[artifactType],
    ),
  ).then(() => ({
    artifactId,
    type: artifactType,
    title: `${titleMap[artifactType]} for ${options.locationQuery}`,
    href: artifactHref(artifactId),
    mimeType: 'image/svg+xml',
  }))
}

function buildPanelFallback(
  app: FastifyInstance,
  artifactType: 'radar-loop' | 'satellite-loop' | 'skewt' | 'brief-report',
  options: ArtifactOptions,
) {
  const titles: Record<typeof artifactType, string> = {
    'radar-loop': 'RainCheck Radar Loop',
    'satellite-loop': 'RainCheck Satellite Loop',
    skewt: 'RainCheck Skew-T',
    'brief-report': 'RainCheck Brief Report',
  }
  const accent: Record<typeof artifactType, string> = {
    'radar-loop': '#ff7a7a',
    'satellite-loop': '#8ec9ff',
    skewt: '#8fe0c7',
    'brief-report': '#78d7cb',
  }
  const artifactId = `${artifactType}-${Date.now()}.html`
  const lines =
    options.frames?.length && (artifactType === 'radar-loop' || artifactType === 'satellite-loop')
      ? options.frames.slice(0, 3).map((frame) =>
          [frame.label, frame.description].filter(Boolean).join(': '),
        )
      : [
          'Structured radar, satellite, model, and sounding inputs are not yet decoded in this local fallback.',
          'The Python weather service will replace this placeholder once richer artifact generation lands.',
          'This file still gives the chat thread a durable, clickable artifact instead of failing silently.',
        ]
  return writeArtifactFile(
    app,
    artifactId,
    buildInfoSvg(
      titles[artifactType],
      `${options.locationQuery} | ${options.prompt}`,
      lines,
      accent[artifactType],
    ),
  ).then(() => ({
    artifactId,
    type: artifactType,
    title: `${titles[artifactType]} for ${options.locationQuery}`,
    href: artifactHref(artifactId),
    mimeType: 'text/html',
  }))
}

export async function generateArtifact(
  app: FastifyInstance,
  options: ArtifactOptions,
) {
  const meteogramForecast =
    options.artifactType === 'meteogram' ||
    options.artifactType === 'rainfall-chart' ||
    options.artifactType === 'snowfall-chart' ||
    options.artifactType === 'hydrograph'
      ? await loadMeteogramForecast(app, options.locationQuery)
      : null
  const requestBody =
    options.artifactType === 'meteogram' && meteogramForecast
      ? {
          artifactType: 'meteogram' as const,
          prompt: options.prompt,
          location: {
            latitude: meteogramForecast.location.latitude,
            longitude: meteogramForecast.location.longitude,
            name: meteogramForecast.location.name,
          },
          chartPoints: resolveChartPoints(options, meteogramForecast),
        }
      : options
  const serviceUp = await checkWeatherService(app)
  if (serviceUp) {
    try {
      const response = await fetch(
        `${app.raincheckEnv.WEATHER_SERVICE_URL}/artifacts/${options.artifactType}`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        },
      )
      if (response.ok) {
        const data = (await response.json()) as {
          artifactId: string
          type?: string
          artifactType?: string
          title: string
          href: string
          mimeType: string
        }
        return {
          ...data,
          type: data.type ?? data.artifactType ?? options.artifactType,
        }
      }
    } catch {
      // Fall back to local generation below.
    }
  }

  if (options.artifactType === 'meteogram') {
    if (!meteogramForecast) {
      throw new Error('Meteogram forecast was not prepared.')
    }

    return buildMeteogramFallback(app, meteogramForecast)
  }

  if (
    options.artifactType === 'rainfall-chart' ||
    options.artifactType === 'snowfall-chart' ||
    options.artifactType === 'hydrograph'
  ) {
    if (!meteogramForecast) {
      throw new Error('Forecast data was not prepared.')
    }

    return buildGenericChartFallback(
      app,
      options.artifactType,
      options,
      meteogramForecast,
    )
  }

  if (
    options.artifactType === 'radar-loop' ||
    options.artifactType === 'satellite-loop' ||
    options.artifactType === 'skewt' ||
    options.artifactType === 'brief-report'
  ) {
    return buildPanelFallback(
      app,
      options.artifactType,
      options,
    )
  }

  const artifactId = `report-${Date.now()}.html`
  await writeArtifactFile(
    app,
    artifactId,
    buildReportHtml(
      'RainCheck Research Report',
      options.locationQuery,
      options.prompt,
      [
        'Official forecast and alerts should anchor the interpretation.',
        'Model guidance, if discussed, should be labeled explicitly as guidance.',
        'Use this report alongside the cited products shown in the chat thread.',
      ],
    ),
  )
  return {
    artifactId,
    type: 'research-report',
    title: `Research report for ${options.locationQuery}`,
    href: artifactHref(artifactId),
    mimeType: 'text/html',
  }
}
