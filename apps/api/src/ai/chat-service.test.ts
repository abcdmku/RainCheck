import { describe, expect, it } from 'vitest'

import { prepareMessagesForProvider } from './chat-service'

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
