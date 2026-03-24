import fs from 'node:fs/promises'
import path from 'node:path'
import { forecastSummarySchema } from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import { resolveWorkspacePath } from '../lib/paths'
import { nowIso } from '../lib/time'
import { getForecast } from './nws'

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

export async function generateArtifact(
  app: FastifyInstance,
  options: {
    artifactType: 'meteogram' | 'research-report'
    locationQuery: string
    prompt: string
  },
) {
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
          body: JSON.stringify(options),
        },
      )
      if (response.ok) {
        const data = (await response.json()) as {
          artifactId: string
          title: string
          href: string
          mimeType: string
        }
        return data
      }
    } catch {
      // Fall back to local generation below.
    }
  }

  if (options.artifactType === 'meteogram') {
    const forecast = forecastSummarySchema.parse(
      await getForecast(app, options.locationQuery, 'short'),
    )
    const points = forecast.periods
      .slice(0, 6)
      .map((period, index) => {
        const x = 40 + index * 100
        const y = 180 - (period.temperature - 30) * 2
        return `${index === 0 ? 'M' : 'L'}${x},${y}`
      })
      .join(' ')
    const artifactId = `meteogram-${Date.now()}.svg`
    await writeArtifactFile(
      app,
      artifactId,
      `<svg xmlns="http://www.w3.org/2000/svg" width="680" height="240" viewBox="0 0 680 240">
        <rect width="680" height="240" fill="#0d1519" rx="18"/>
        <path d="${points}" fill="none" stroke="#6dd6cb" stroke-width="4"/>
        <text x="28" y="36" fill="#f5f7f8" font-family="sans-serif" font-size="18">RainCheck Meteogram</text>
        <text x="28" y="60" fill="#9ab2b6" font-family="sans-serif" font-size="12">${forecast.location.name}</text>
      </svg>`,
    )
    return {
      artifactId,
      title: `Meteogram for ${forecast.location.name}`,
      href: artifactHref(artifactId),
      mimeType: 'image/svg+xml',
    }
  }

  const artifactId = `report-${Date.now()}.html`
  await writeArtifactFile(
    app,
    artifactId,
    `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>RainCheck Research Report</title>
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
          <div class="eyebrow">RainCheck research report</div>
          <h1>${options.locationQuery}</h1>
          <p>Generated at ${nowIso()}</p>
          <p>${options.prompt}</p>
          <ul>
            <li>Official forecast and alerts should anchor the interpretation.</li>
            <li>Model guidance, if discussed, should be labeled explicitly as guidance.</li>
            <li>Use this report alongside the cited products shown in the chat thread.</li>
          </ul>
        </main>
      </body>
    </html>`,
  )
  return {
    artifactId,
    title: `Research report for ${options.locationQuery}`,
    href: artifactHref(artifactId),
    mimeType: 'text/html',
  }
}
