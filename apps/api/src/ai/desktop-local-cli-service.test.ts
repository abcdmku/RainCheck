import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

vi.mock('./tools', () => ({
  buildServerTools: vi.fn(() => [
    {
      name: 'resolve_location',
      description: 'Resolve a location label for the current turn.',
      inputSchema: z.object({
        locationQuery: z.string().min(1),
      }),
      execute: async (
        args: { locationQuery: string },
        context?: {
          emitCustomEvent?: (
            name: string,
            value: Record<string, unknown>,
          ) => void
        },
      ) => {
        context?.emitCustomEvent?.('tool-progress', {
          label: 'Resolving location',
        })

        return {
          summary: `Resolved ${args.locationQuery}`,
          citations: [
            {
              id: 'resolve-location',
              label: 'Resolved location',
              sourceId: 'geocoder',
              productId: 'lookup',
              kind: 'page',
              url: 'https://example.com/location',
            },
          ],
        }
      },
    },
    {
      name: 'synthesize_weather_conclusion',
      description: 'Synthesize the fetched weather evidence.',
      inputSchema: z.object({
        summary: z.string().min(1),
      }),
      execute: async (
        args: { summary: string },
        context?: {
          emitCustomEvent?: (
            name: string,
            value: Record<string, unknown>,
          ) => void
        },
      ) => {
        context?.emitCustomEvent?.('tool-progress', {
          label: 'Synthesizing weather conclusion',
        })

        return {
          bottomLine: args.summary,
          citations: [
            {
              id: 'synthesis-source',
              label: 'Synthesized source',
              sourceId: 'raincheck',
              productId: 'synthesis',
              kind: 'page',
              url: 'https://example.com/synthesis',
            },
          ],
        }
      },
    },
  ]),
}))

const requiredEnv = {
  NODE_ENV: 'test',
  RAINCHECK_APP_URL: 'http://localhost:3000',
  API_BASE_URL: 'http://localhost:3001',
  WEATHER_SERVICE_URL: 'http://localhost:8000',
  DB_URL: ':memory:',
  ARTIFACTS_DIR: './artifacts/generated',
  APP_ENCRYPTION_KEY: '12345678901234567890123456789012',
  OPENAI_API_KEY: 'shared-openai',
  DEFAULT_CHAT_PROVIDER: 'openai',
  DEFAULT_CHAT_MODEL: 'gpt-4.1-mini',
  DEFAULT_RESEARCH_PROVIDER: 'openai',
  DEFAULT_RESEARCH_MODEL: 'gpt-4.1',
  DEFAULT_VISION_PROVIDER: 'openai',
  DEFAULT_VISION_MODEL: 'gpt-4.1-mini',
  NWS_USER_AGENT: 'RainCheck Test',
}

const { buildApp } = await import('../app')
const { createConversation, getConversation } = await import(
  '../services/conversations-service'
)

describe('desktop local CLI helper routes', () => {
  let app: ReturnType<typeof buildApp>

  beforeAll(() => {
    Object.assign(process.env, requiredEnv)
    app = buildApp({
      weatherServiceCheck: async () => false,
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('prepares, executes tools, and completes a desktop local CLI turn', async () => {
    const conversation = await createConversation(app, {
      title: 'Desktop local CLI',
    })
    const prepareResponse = await app.inject({
      method: 'POST',
      url: '/api/desktop/local-cli/prepare',
      payload: {
        apiBaseUrl: 'http://localhost:3001',
        conversationId: conversation.id,
        message: 'How does Chicago look today?',
        clientMessageId: 'client-msg-1',
        providerId: 'openai',
        model: 'gpt-5',
        route: {
          transport: 'local-cli',
          source: 'desktop-local-cli',
        },
        context: {
          location: {
            label: 'Chicago, IL',
          },
          units: 'imperial',
          timeDisplay: 'user-local',
          answerTone: 'casual',
          displayTimezone: 'America/Chicago',
        },
      },
    })

    expect(prepareResponse.statusCode).toBe(200)
    const prepared = prepareResponse.json() as {
      session: {
        conversationId: string
        userMessageId: string
        route: {
          transport: 'local-cli'
          source: 'desktop-local-cli'
        }
        toolCatalog: Array<{ name: string }>
      }
    }
    expect(prepared.session.conversationId).toBe(conversation.id)
    expect(prepared.session.userMessageId).toBeTruthy()
    expect(prepared.session.route).toMatchObject({
      transport: 'local-cli',
      source: 'desktop-local-cli',
    })
    expect(prepared.session.toolCatalog.map((tool) => tool.name)).toEqual([
      'resolve_location',
      'synthesize_weather_conclusion',
    ])

    const executeResponse = await app.inject({
      method: 'POST',
      url: '/api/desktop/local-cli/execute-tools',
      payload: {
        session: prepared.session,
        toolCalls: [
          {
            name: 'resolve_location',
            arguments: {
              locationQuery: 'Chicago, IL',
            },
          },
          {
            name: 'synthesize_weather_conclusion',
            arguments: {
              summary: 'Chicago looks generally quiet today.',
            },
          },
        ],
      },
    })

    expect(executeResponse.statusCode).toBe(200)
    const executed = executeResponse.json() as {
      progressEvents: Array<{ label: string }>
      results: Array<{ name: string; result: Record<string, unknown> }>
    }
    expect(executed.progressEvents.map((event) => event.label)).toContain(
      'Resolving location',
    )
    expect(executed.results.map((result) => result.name)).toEqual([
      'resolve_location',
      'synthesize_weather_conclusion',
    ])

    const completeResponse = await app.inject({
      method: 'POST',
      url: '/api/desktop/local-cli/complete',
      payload: {
        session: prepared.session,
        responseText: 'Chicago looks generally quiet today.',
        toolResults: executed.results,
      },
    })

    expect(completeResponse.statusCode).toBe(200)
    const completed = completeResponse.json() as {
      message: {
        role: 'assistant'
        transport: 'local-cli'
        source: 'desktop-local-cli'
        model: string
      }
      citations: Array<{ label: string }>
    }
    expect(completed.message).toMatchObject({
      role: 'assistant',
      transport: 'local-cli',
      source: 'desktop-local-cli',
      model: 'gpt-5',
    })
    expect(completed.citations.length).toBeGreaterThan(0)

    const storedConversation = await getConversation(app, conversation.id)
    expect(storedConversation?.messages.at(-1)).toMatchObject({
      role: 'assistant',
      transport: 'local-cli',
      source: 'desktop-local-cli',
      model: 'gpt-5',
      provider: 'openai',
    })
  })

  it('rejects tool calls outside the prepared allowlist', async () => {
    const conversation = await createConversation(app, {
      title: 'Desktop local CLI disallowed tool',
    })
    const prepareResponse = await app.inject({
      method: 'POST',
      url: '/api/desktop/local-cli/prepare',
      payload: {
        apiBaseUrl: 'http://localhost:3001',
        conversationId: conversation.id,
        message: 'What should I use?',
        providerId: 'anthropic',
        model: 'claude-sonnet-4-5',
        route: {
          transport: 'local-cli',
          source: 'desktop-local-cli',
        },
        context: {
          location: null,
          units: 'imperial',
          timeDisplay: 'user-local',
          answerTone: 'casual',
          displayTimezone: 'America/Chicago',
        },
      },
    })
    const prepared = prepareResponse.json() as {
      session: Record<string, unknown>
    }

    const executeResponse = await app.inject({
      method: 'POST',
      url: '/api/desktop/local-cli/execute-tools',
      payload: {
        session: prepared.session,
        toolCalls: [
          {
            name: 'unknown_tool',
            arguments: {},
          },
        ],
      },
    })

    expect(executeResponse.statusCode).toBe(400)
    expect(executeResponse.json()).toMatchObject({
      error: {
        message: 'Tool is not allowed for this session: unknown_tool',
      },
    })
  })
})
