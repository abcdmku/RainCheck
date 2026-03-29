import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../app'

const requiredEnv = {
  NODE_ENV: 'test',
  RAINCHECK_APP_URL: 'http://localhost:3000',
  API_BASE_URL: 'http://localhost:3001',
  WEATHER_SERVICE_URL: 'http://localhost:8000',
  DB_URL: ':memory:',
  ARTIFACTS_DIR: './artifacts/generated',
  APP_ENCRYPTION_KEY: '12345678901234567890123456789012',
  OPENAI_API_KEY: 'test-openai',
  DEFAULT_CHAT_PROVIDER: 'openai',
  DEFAULT_CHAT_MODEL: 'gpt-4.1-mini',
  DEFAULT_RESEARCH_PROVIDER: 'openai',
  DEFAULT_RESEARCH_MODEL: 'gpt-4.1',
  DEFAULT_VISION_PROVIDER: 'openai',
  DEFAULT_VISION_MODEL: 'gpt-4.1-mini',
  NWS_USER_AGENT: 'RainCheck Test',
}

describe('chat streaming route', () => {
  let serverUrl = ''
  let app: Awaited<ReturnType<typeof buildApp>>
  let capturedBody: Record<string, unknown> | null = null

  beforeAll(async () => {
    Object.assign(process.env, requiredEnv)
    app = await buildApp({
      chatHandler: async (_app, body) => {
        capturedBody = body as Record<string, unknown>

        return {
          route: {
            taskClass: 'chat',
            provider: 'openai',
            model: 'gpt-4.1-mini',
            reason: 'test route',
            transport: 'api',
            source: 'shared-env',
            availableProviders: ['openai'],
          },
          classification: {
            taskClass: 'chat',
            intent: 'current-conditions',
            timeHorizonHours: 6,
            locationRequired: true,
            needsArtifact: false,
          },
          stream: (async function* () {
            yield {
              type: 'TEXT_MESSAGE_CONTENT',
              model: 'gpt-4.1-mini',
              timestamp: Date.now(),
              delta: 'Streaming test response',
            }
            yield {
              type: 'RUN_FINISHED',
              model: 'gpt-4.1-mini',
              runId: 'run-test',
              timestamp: Date.now(),
              finishReason: 'stop',
            }
          })(),
        }
      },
      weatherServiceCheck: async () => false,
    })
    serverUrl = await app.listen({ port: 0, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await app.close()
  })

  it('streams SSE chunks from the chat endpoint', async () => {
    capturedBody = null
    const response = await fetch(`${serverUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: 'thread-test',
        messages: [{ role: 'user', content: 'Hello weather' }],
      }),
    })

    expect(response.ok).toBe(true)
    expect(response.headers.get('x-raincheck-runtime-id')).toBeTruthy()
    expect(response.headers.get('x-raincheck-weather-service-url')).toBe(
      'http://localhost:8000',
    )
    expect(response.headers.get('x-raincheck-route')).toContain('gpt-4.1-mini')
    const text = await response.text()
    expect(text).toContain('"type":"CUSTOM"')
    expect(text).toContain('"name":"runtime-info"')
    expect(text).toContain('TEXT_MESSAGE_CONTENT')
    expect(text).toContain('Streaming test response')
    expect(text).toContain('[DONE]')
  })

  it('forwards the selected location override to the chat handler', async () => {
    capturedBody = null

    const response = await fetch(`${serverUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: 'thread-test',
        messages: [
          { role: 'user', content: 'Best day to work outside this week?' },
        ],
        displayTimezone: 'America/Chicago',
        locationOverride: {
          label: 'Austin, TX',
          latitude: 30.2672,
          longitude: -97.7431,
          timezone: 'America/Chicago',
        },
      }),
    })

    expect(response.ok).toBe(true)
    expect(capturedBody).toMatchObject({
      displayTimezone: 'America/Chicago',
      locationOverride: {
        label: 'Austin, TX',
        latitude: 30.2672,
        longitude: -97.7431,
        timezone: 'America/Chicago',
      },
    })
  })

  it('returns runtime diagnostics from the dedicated endpoint', async () => {
    const response = await fetch(`${serverUrl}/api/runtime`)

    expect(response.ok).toBe(true)
    await expect(response.json()).resolves.toMatchObject({
      runtime: {
        runtimeId: expect.stringContaining('api-'),
        environment: 'test',
        apiBaseUrl: 'http://localhost:3001',
        weatherServiceUrl: 'http://localhost:8000',
      },
    })
  })
})
