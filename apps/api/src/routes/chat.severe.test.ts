import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

const { chatMock, maxIterationsMock, recoverWeatherToolResultsMock } =
  vi.hoisted(() => ({
    chatMock: vi.fn(),
    maxIterationsMock: vi.fn((count: number) => `max-${count}`),
    recoverWeatherToolResultsMock: vi.fn(async () => []),
  }))

vi.mock('@tanstack/ai', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/ai')>('@tanstack/ai')

  return {
    ...actual,
    chat: chatMock,
    maxIterations: maxIterationsMock,
  }
})

vi.mock('../ai/adapters', () => ({
  buildAdapter: vi.fn(async () => ({ model: 'gpt-4.1-mini' })),
}))

vi.mock('../ai/weather-recovery', async () => {
  const actual =
    await vi.importActual<typeof import('../ai/weather-recovery')>(
      '../ai/weather-recovery'
    )

  return {
    ...actual,
    recoverWeatherToolResults: recoverWeatherToolResultsMock,
  }
})

import { buildApp } from '../app'
import { createConversation } from '../services/conversations-service'

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

async function* streamChunks(chunks: Array<any>) {
  for (const chunk of chunks) {
    yield chunk
  }
}

describe('chat severe-weather route contract', () => {
  let serverUrl = ''
  let app: Awaited<ReturnType<typeof buildApp>>

  beforeAll(async () => {
    Object.assign(process.env, requiredEnv)
    app = await buildApp({
      weatherServiceCheck: async () => false,
    })
    serverUrl = await app.listen({ port: 0, host: '127.0.0.1' })
  })

  afterAll(async () => {
    await app.close()
  })

  it('never ships derivation-only severe-weather fallback text for the bad Columbus prompt', async () => {
    const conversation = await createConversation(app, {
      title: 'Severe route contract',
    })

    chatMock.mockReturnValueOnce(
      streamChunks([
        {
          type: 'RUN_STARTED',
          runId: 'run-severe-route',
          model: 'gpt-4.1-mini',
          timestamp: 1,
        },
        {
          type: 'TEXT_MESSAGE_START',
          messageId: 'msg-severe-route',
          model: 'gpt-4.1-mini',
          timestamp: 1,
          role: 'assistant',
        },
        {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'msg-severe-route',
          model: 'gpt-4.1-mini',
          timestamp: 1,
          delta:
            'Why RainCheck thinks that: Radar Nowcast evidence for Columbus, Ohio, United States is led by NEXRAD, MRMS; nexrad is the most repeated source family with direct upstream support.',
          content:
            'Why RainCheck thinks that: Radar Nowcast evidence for Columbus, Ohio, United States is led by NEXRAD, MRMS; nexrad is the most repeated source family with direct upstream support.',
        },
        {
          type: 'TEXT_MESSAGE_END',
          messageId: 'msg-severe-route',
          model: 'gpt-4.1-mini',
          timestamp: 1,
        },
        {
          type: 'TOOL_CALL_END',
          toolCallId: 'tool-derive-route',
          toolName: 'derive_radar_nowcast',
          model: 'gpt-4.1-mini',
          timestamp: 1,
          result: JSON.stringify({
            agreementSummary:
              'Radar Nowcast evidence for Columbus, Ohio, United States is led by NEXRAD, MRMS; nexrad is the most repeated source family with direct upstream support.',
            keyConflicts: [
              'Storm mergers or radar sampling gaps could change the strongest object quickly.',
            ],
            evidenceProducts: [],
          }),
        },
        {
          type: 'RUN_FINISHED',
          runId: 'run-severe-route',
          model: 'gpt-4.1-mini',
          timestamp: 2,
          finishReason: 'stop',
        },
      ]),
    )

    const response = await fetch(`${serverUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        conversationId: conversation.id,
        messages: [
          {
            role: 'user',
            content: 'best storm to spot currently?',
          },
        ],
      }),
    })

    const text = await response.text()
    if (!response.ok) {
      throw new Error(text)
    }

    expect(recoverWeatherToolResultsMock).toHaveBeenCalled()
    expect(text).toContain(
      "I don't have enough live severe-weather data yet to make a confident setup call. Check back after the next radar or model update.",
    )
    expect(text).not.toContain(
      'Why RainCheck thinks that: Radar Nowcast evidence for Columbus',
    )
  })
})
