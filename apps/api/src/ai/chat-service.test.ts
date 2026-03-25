import { describe, expect, it } from 'vitest'

import { prepareMessagesForProvider } from './chat-service'

describe('prepareMessagesForProvider', () => {
  it('strips tool-call and tool-result history for gemini continuations', () => {
    const messages = prepareMessagesForProvider(
      [
        {
          role: 'assistant',
          content: 'Resolved Yorkville and fetched the forecast.',
          parts: [
            {
              type: 'text',
              content: 'Resolved Yorkville and fetched the forecast.',
            },
            {
              type: 'tool-call',
              id: 'tool-1',
              name: 'resolve_location',
              arguments: '{"query":"Yorkville, IL"}',
              state: 'input-complete',
              output: {
                name: 'Yorkville, Illinois, United States',
              },
            },
            {
              type: 'tool-result',
              toolCallId: 'tool-1',
              content: '{"name":"Yorkville, Illinois, United States"}',
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
        content: 'Resolved Yorkville and fetched the forecast.',
        parts: [
          {
            type: 'text',
            content: 'Resolved Yorkville and fetched the forecast.',
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

  it('leaves non-gemini histories untouched', () => {
    const messages = [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            id: 'tool-1',
            name: 'resolve_location',
            arguments: '{"query":"Chicago"}',
            state: 'input-complete',
          },
        ],
      },
    ]

    expect(prepareMessagesForProvider(messages, 'openai')).toBe(messages)
  })
})
