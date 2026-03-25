import { afterEach, describe, expect, it, vi } from 'vitest'

const { chatMock, maxIterationsMock } = vi.hoisted(() => ({
  chatMock: vi.fn(),
  maxIterationsMock: vi.fn((count: number) => `max-${count}`),
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

import { streamGeminiWithToolContext } from './chat-service'

async function* streamChunks(chunks: Array<any>) {
  for (const chunk of chunks) {
    yield chunk
  }
}

describe('streamGeminiWithToolContext', () => {
  afterEach(() => {
    chatMock.mockReset()
    maxIterationsMock.mockClear()
  })

  it('replays tool outputs as synthetic context for the next Gemini turn', async () => {
    chatMock
      .mockReturnValueOnce(
        streamChunks([
          {
            type: 'RUN_STARTED',
            runId: 'run-1',
            model: 'gemini-3.1-pro-preview',
            timestamp: 1,
          },
          {
            type: 'TOOL_CALL_START',
            toolCallId: 'tool-1',
            toolName: 'get_severe_context',
            model: 'gemini-3.1-pro-preview',
            timestamp: 1,
            index: 0,
          },
          {
            type: 'TOOL_CALL_ARGS',
            toolCallId: 'tool-1',
            model: 'gemini-3.1-pro-preview',
            timestamp: 1,
            delta: '{"locationQuery":"Central IL"}',
            args: '{"locationQuery":"Central IL"}',
          },
          {
            type: 'TOOL_CALL_END',
            toolCallId: 'tool-1',
            toolName: 'get_severe_context',
            model: 'gemini-3.1-pro-preview',
            timestamp: 1,
            input: {
              locationQuery: 'Central IL',
            },
          },
          {
            type: 'RUN_FINISHED',
            runId: 'run-1',
            model: 'gemini-3.1-pro-preview',
            timestamp: 1,
            finishReason: 'tool_calls',
          },
          {
            type: 'TOOL_CALL_END',
            toolCallId: 'tool-1',
            toolName: 'get_severe_context',
            model: 'gemini-3.1-pro-preview',
            timestamp: 2,
            result:
              '{"summary":"SPC Day 1 Convective Outlook: Central Illinois stays inside the higher tornado corridor this evening.","location":{"query":"Central IL","name":"Illinois, United States","latitude":40,"longitude":-89,"resolvedBy":"open-meteo-geocoding"}}',
          },
        ]),
      )
      .mockReturnValueOnce(
        streamChunks([
          {
            type: 'RUN_STARTED',
            runId: 'run-2',
            model: 'gemini-3.1-pro-preview',
            timestamp: 3,
          },
          {
            type: 'TEXT_MESSAGE_START',
            messageId: 'msg-2',
            model: 'gemini-3.1-pro-preview',
            timestamp: 3,
            role: 'assistant',
          },
          {
            type: 'TEXT_MESSAGE_CONTENT',
            messageId: 'msg-2',
            model: 'gemini-3.1-pro-preview',
            timestamp: 3,
            delta:
              'Use Illinois as the target area and avoid the higher tornado corridor this evening.',
            content:
              'Use Illinois as the target area and avoid the higher tornado corridor this evening.',
          },
          {
            type: 'TEXT_MESSAGE_END',
            messageId: 'msg-2',
            model: 'gemini-3.1-pro-preview',
            timestamp: 3,
          },
          {
            type: 'RUN_FINISHED',
            runId: 'run-2',
            model: 'gemini-3.1-pro-preview',
            timestamp: 3,
            finishReason: 'stop',
          },
        ]),
      )

    const streamed: Array<any> = []
    for await (const chunk of streamGeminiWithToolContext({
      adapter: { model: 'gemini-3.1-pro-preview' },
      messages: [
        {
          role: 'user',
          content: 'In central IL where should I avoid because of tornados?',
        },
      ],
      tools: [
        {
          name: 'get_severe_context',
        },
      ],
      systemPrompt: 'You are RainCheck.',
      conversationId: 'conv-1',
      middleware: [],
    })) {
      streamed.push(chunk)
    }

    expect(streamed).toHaveLength(11)
    expect(chatMock).toHaveBeenCalledTimes(2)
    expect(maxIterationsMock).toHaveBeenCalledTimes(2)
    expect(maxIterationsMock).toHaveBeenNthCalledWith(1, 1)
    expect(maxIterationsMock).toHaveBeenNthCalledWith(2, 1)

    const secondCall = chatMock.mock.calls[1]?.[0]
    expect(secondCall.messages).toEqual([
      {
        role: 'user',
        content: 'In central IL where should I avoid because of tornados?',
      },
      expect.objectContaining({
        role: 'user',
        content: expect.stringContaining('TOOL RESULT CONTEXT'),
      }),
    ])
    expect(secondCall.messages[1].content).toContain('get_severe_context')
    expect(secondCall.messages[1].content).toContain('Illinois, United States')
    expect(secondCall.systemPrompts).toEqual(
      expect.arrayContaining([
        'You are RainCheck.',
        expect.stringContaining('TOOL RESULT CONTEXT'),
      ]),
    )
  })

  it('falls back to recovered synthesized weather text when a Gemini follow-up call fails', async () => {
    chatMock
      .mockReturnValueOnce(
        streamChunks([
          {
            type: 'RUN_STARTED',
            runId: 'run-1',
            model: 'gemini-3.1-pro-preview',
            timestamp: 1,
          },
          {
            type: 'TOOL_CALL_END',
            toolCallId: 'tool-1',
            toolName: 'get_severe_context',
            model: 'gemini-3.1-pro-preview',
            timestamp: 2,
            input: {
              locationQuery: 'central Illinois',
            },
            result:
              '{"summary":"SPC context shows the primary tornado corridor overlaps central Illinois.","location":{"query":"central Illinois","name":"Illinois, United States","latitude":40,"longitude":-89,"resolvedBy":"open-meteo-geocoding"},"normalizedForecast":{"domain":"severe-context","headline":"SPC context headline"}}',
          },
          {
            type: 'RUN_FINISHED',
            runId: 'run-1',
            model: 'gemini-3.1-pro-preview',
            timestamp: 3,
            finishReason: 'tool_calls',
          },
        ]),
      )
      .mockImplementationOnce(() => {
        throw new Error('503 high demand')
      })

    const streamed: Array<any> = []
    for await (const chunk of streamGeminiWithToolContext({
      adapter: { model: 'gemini-3.1-pro-preview' },
      messages: [
        {
          role: 'user',
          content:
            'in central IL where should i avoid and what time according to the HRRR model because of tornados',
        },
      ],
      tools: [
        {
          name: 'get_severe_context',
        },
      ],
      systemPrompt: 'You are RainCheck.',
      conversationId: 'conv-2',
      middleware: [],
      recoverToolResults: async () => [
        {
          toolCallId: 'recovery-synthesis',
          toolName: 'synthesize_weather_conclusion',
          result: {
            bottomLine:
              'Avoid the central Illinois tornado corridor late afternoon into the evening.',
            confidence: {
              level: 'medium',
              reason:
                'SPC severe context and short-range guidance support the same corridor.',
            },
            mostLikelyScenario:
              'The highest tornado risk stays near the warm front as storms mature toward evening.',
            keySignals: [
              'SPC keeps central Illinois inside the higher-end severe corridor.',
              'Short-range guidance clusters initiation later in the afternoon.',
            ],
            conflicts: [
              'Storm mode could stay more linear if forcing outruns destabilization.',
            ],
            productCards: [
              {
                title: 'SPC Day 2 Convective Outlook',
              },
              {
                title: 'HREF probabilities',
              },
            ],
          },
        },
      ],
    })) {
      streamed.push(chunk)
    }

    expect(chatMock).toHaveBeenCalledTimes(2)
    expect(
      streamed.some(
        (chunk) =>
          chunk.type === 'TOOL_CALL_END' &&
          chunk.toolName === 'synthesize_weather_conclusion',
      ),
    ).toBe(true)
    expect(
      streamed.some(
        (chunk) =>
          chunk.type === 'TEXT_MESSAGE_CONTENT' &&
          String(chunk.content).includes(
            'Avoid the central Illinois tornado corridor late afternoon into the evening.',
          ),
      ),
    ).toBe(true)
  })
})
