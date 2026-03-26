import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../app'
import {
  createConversation,
  getConversation,
  saveMessage,
} from '../services/conversations-service'
import { handleChatRequest, prepareMessagesForProvider } from './chat-service'

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

describe('prepareMessagesForProvider', () => {
  it('strips tool-call and tool-result history for gemini continuations', () => {
    const messages = prepareMessagesForProvider(
      [
        {
          role: 'assistant',
          content: 'Fetched the forecast for Yorkville.',
          parts: [
            {
              type: 'text',
              content: 'Fetched the forecast for Yorkville.',
            },
            {
              type: 'tool-call',
              id: 'tool-1',
              name: 'get_forecast',
              arguments: '{"locationQuery":"Yorkville, IL","horizon":"short"}',
              state: 'input-complete',
              output: {
                summary: 'Yorkville stays dry tonight.',
              },
            },
            {
              type: 'tool-result',
              toolCallId: 'tool-1',
              content: '{"summary":"Yorkville stays dry tonight."}',
              state: 'complete',
            },
          ],
        },
        {
          role: 'user',
          content: 'Where should I head in central IL?',
          parts: [
            {
              type: 'text',
              content: 'Where should I head in central IL?',
            },
          ],
        },
      ],
      'gemini',
    )

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: 'Fetched the forecast for Yorkville.',
        parts: [
          {
            type: 'text',
            content: 'Fetched the forecast for Yorkville.',
          },
        ],
      },
      {
        role: 'user',
        content: 'Where should I head in central IL?',
        parts: [
          {
            type: 'text',
            content: 'Where should I head in central IL?',
          },
        ],
      },
    ])
  })

  it('strips historical tool parts for non-gemini providers too', () => {
    const messages = prepareMessagesForProvider(
      [
        {
          role: 'assistant',
          content: 'Fetched alerts for Chicago before answering.',
          parts: [
            {
              type: 'text',
              content: 'Fetched alerts for Chicago before answering.',
            },
            {
              type: 'tool-call',
              id: 'tool-1',
              name: 'get_alerts',
              arguments: '{"locationQuery":"Chicago"}',
              state: 'input-complete',
              output: {
                summary: 'No active alerts for Chicago.',
              },
            },
          ],
        },
      ],
      'openai',
    )

    expect(messages).toEqual([
      {
        role: 'assistant',
        content: 'Fetched alerts for Chicago before answering.',
        parts: [
          {
            type: 'text',
            content: 'Fetched alerts for Chicago before answering.',
          },
        ],
      },
    ])
  })
})

describe('handleChatRequest', () => {
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

  it('treats an already-answered user turn as a no-op', async () => {
    const conversation = await createConversation(app, {
      title: 'Duplicate request guard',
    })

    await saveMessage(app, {
      conversationId: conversation.id,
      role: 'user',
      content: 'Where should I start from Yorkville for tonight?',
      parts: [
        {
          type: 'text',
          content: 'Where should I start from Yorkville for tonight?',
          clientMessageId: 'req-1',
        },
      ],
    })

    await saveMessage(app, {
      conversationId: conversation.id,
      role: 'assistant',
      content: 'Start west of Yorkville and adjust once storms initiate.',
      parts: [
        {
          type: 'text',
          content: 'Start west of Yorkville and adjust once storms initiate.',
        },
      ],
      provider: 'openai',
      model: 'gpt-4.1-mini',
    })

    const result = await handleChatRequest(app, {
      conversationId: conversation.id,
      messages: [
        {
          id: 'req-1',
          role: 'user',
          parts: [
            {
              type: 'text',
              content: 'Where should I start from Yorkville for tonight?',
            },
          ],
        },
      ],
      provider: 'openai',
      model: 'gpt-4.1-mini',
    })

    const chunks = []
    for await (const chunk of result.stream) {
      chunks.push(chunk)
    }

    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toMatchObject({
      type: 'RUN_FINISHED',
      finishReason: 'stop',
    })

    const persistedConversation = await getConversation(app, conversation.id)
    expect(persistedConversation?.messages).toHaveLength(2)
  })
})
