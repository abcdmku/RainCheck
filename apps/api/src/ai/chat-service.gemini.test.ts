import type { RequestClassification } from '@raincheck/contracts'
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

import { streamGeminiWithToolContext, streamValidatedSevereWeatherResponse } from './chat-service'

async function* streamChunks(chunks: Array<any>) {
  for (const chunk of chunks) {
    yield chunk
  }
}

const severeClassification: RequestClassification = {
  taskClass: 'research',
  intent: 'severe-weather',
  timeHorizonHours: 6,
  locationRequired: true,
  needsArtifact: false,
  chaseGuidanceLevel: 'general-target',
  answerMode: 'single',
  candidateMode: 'named',
  rankLimit: 1,
  rankingObjective: undefined,
}

const analysisOnlySevereClassification: RequestClassification = {
  ...severeClassification,
  chaseGuidanceLevel: 'analysis-only',
  locationRequired: false,
}

const forecastClassification: RequestClassification = {
  taskClass: 'research',
  intent: 'forecast',
  timeHorizonHours: 6,
  locationRequired: true,
  needsArtifact: false,
  chaseGuidanceLevel: 'analysis-only',
  answerMode: 'single',
  candidateMode: 'named',
  rankLimit: 1,
  rankingObjective: undefined,
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
      answerTone: 'casual',
      classification: forecastClassification,
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

  it('prefers synthesized weather fallback text over a verbose Gemini follow-up answer', async () => {
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
              locationQuery: 'Yorkville, IL',
            },
            result: JSON.stringify({
              summary:
                'SPC keeps northern Illinois in the enhanced severe corridor late Thursday afternoon and evening.',
              confidence: 0.9,
              location: {
                query: 'Yorkville, IL',
                name: 'Yorkville, Illinois, United States',
                latitude: 41.64,
                longitude: -88.45,
                resolvedBy: 'open-meteo-geocoding',
              },
              normalizedForecast: {
                domain: 'severe-context',
                headline:
                  'SPC official severe context should anchor the severe-weather call for Yorkville, Illinois, United States.',
                keySignals: [],
                conflicts: [],
              },
            }),
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
      .mockReturnValueOnce(
        streamChunks([
          {
            type: 'RUN_STARTED',
            runId: 'run-2',
            model: 'gemini-3.1-pro-preview',
            timestamp: 4,
          },
        ]),
      )

    const streamed: Array<any> = []
    for await (const chunk of streamGeminiWithToolContext({
      adapter: { model: 'gemini-3.1-pro-preview' },
      answerTone: 'casual',
      classification: analysisOnlySevereClassification,
      messages: [
        {
          role: 'user',
          content:
            'im in yorkville il whats the best plan to follow these upcoming storms to chase a tornado',
        },
      ],
      tools: [
        {
          name: 'get_severe_context',
        },
      ],
      systemPrompt: 'You are RainCheck.',
      conversationId: 'conv-1b',
      middleware: [],
      recoverToolResults: async () => [
        {
          toolCallId: 'recovery-synthesis',
          toolName: 'synthesize_weather_conclusion',
          result: {
            bottomLine:
              'From Yorkville, treat the late-afternoon into evening severe window as the main chase period and stay ready to adjust south or southwest with later updates.',
            confidence: {
              level: 'medium',
              reason:
                'SPC severe context and the short-range guidance point to the same general window, but the exact initiation corridor can still shift.',
            },
            mostLikelyScenario:
              'Storms develop late in the afternoon and become more tornadic as they mature into the evening.',
            keySignals: [
              'SPC keeps northern Illinois in the enhanced severe corridor.',
              'Short-range guidance supports a later-afternoon to evening storm window.',
            ],
            conflicts: [
              'The first supercell corridor can still wobble if the warm front or outflow boundaries shift.',
            ],
            productCards: [],
          },
        },
      ],
    })) {
      streamed.push(chunk)
    }

    expect(chatMock).toHaveBeenCalledTimes(1)
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
            'From Yorkville, treat the 4 PM to 10 PM local time severe window as the main chase period',
          ),
      ),
    ).toBe(true)
  })

  it('continues when recovery adds tool results after an initial Gemini tool-only turn', async () => {
    chatMock.mockReturnValueOnce(
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
          toolName: 'resolve_location',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          index: 0,
        },
        {
          type: 'TOOL_CALL_ARGS',
          toolCallId: 'tool-1',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          delta: '{"locationQuery":"Yorkville, IL"}',
          args: '{"locationQuery":"Yorkville, IL"}',
        },
        {
          type: 'TOOL_CALL_END',
          toolCallId: 'tool-1',
          toolName: 'resolve_location',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          input: {
            locationQuery: 'Yorkville, IL',
          },
        },
        {
          type: 'RUN_FINISHED',
          runId: 'run-1',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          finishReason: 'tool_calls',
        },
      ]),
    )

    const streamed: Array<any> = []
    for await (const chunk of streamGeminiWithToolContext({
      adapter: { model: 'gemini-3.1-pro-preview' },
      answerTone: 'casual',
      classification: analysisOnlySevereClassification,
      messages: [
        {
          role: 'user',
          content:
            'im in yorkville il whats the best plan to follow these upcoming storms to chase a tornado',
        },
      ],
      tools: [
        {
          name: 'resolve_location',
        },
      ],
      systemPrompt: 'You are RainCheck.',
      conversationId: 'conv-2',
      middleware: [],
      recoverToolResults: async () => [
        {
          toolCallId: 'recovery-severe',
          toolName: 'get_severe_context',
          result: {
            summary:
              'SPC keeps northern Illinois in the enhanced severe corridor late Thursday afternoon and evening.',
            confidence: 0.9,
            location: {
              query: 'Yorkville, IL',
              name: 'Yorkville, Illinois, United States',
              latitude: 41.64,
              longitude: -88.45,
              resolvedBy: 'open-meteo-geocoding',
            },
            normalizedForecast: {
              domain: 'severe-context',
              headline:
                'SPC official severe context should anchor the severe-weather call for Yorkville, Illinois, United States.',
              mostLikelyScenario:
                'Discrete storms are most likely late afternoon into the evening.',
              alternateScenarios: [],
              confidence: 'medium',
              likelihood: 'medium',
              keySignals: [],
              conflicts: [],
              failureModes: [],
              whatWouldChange: [],
              productCards: [],
              recommendedProductIds: [],
            },
          },
        },
        {
          toolCallId: 'recovery-synthesis',
          toolName: 'synthesize_weather_conclusion',
          result: {
            bottomLine:
              'From Yorkville, treat late afternoon into evening as the main chase window and stay flexible inside the broader northern Illinois severe corridor.',
            confidence: {
              level: 'medium',
              reason:
                'SPC severe context supports a later-afternoon into evening chase window, but the exact storm corridor can still shift.',
            },
            mostLikelyScenario:
              'Storms become most chase-worthy late afternoon into evening if cells stay discrete before clustering later.',
            keySignals: [
              'SPC keeps northern Illinois in the enhanced severe corridor.',
            ],
            conflicts: [
              'The first supercell corridor can still wobble if boundaries shift.',
            ],
            productCards: [],
          },
        },
      ],
    })) {
      streamed.push(chunk)
    }

    expect(chatMock).toHaveBeenCalledTimes(1)
    expect(
      streamed.some(
        (chunk) =>
          chunk.type === 'TOOL_CALL_END' &&
          chunk.toolName === 'get_severe_context',
      ),
    ).toBe(true)
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
            'From Yorkville, treat 4 PM to 10 PM local time as the main chase window',
          ),
      ),
    ).toBe(true)
  })

  it('uses the severe limitation text when only derivation results exist and recovery cannot synthesize an answer', async () => {
    chatMock.mockReturnValueOnce(
      streamChunks([
        {
          type: 'RUN_STARTED',
          runId: 'run-3',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'TOOL_CALL_END',
          toolCallId: 'tool-derive-only',
          toolName: 'derive_radar_nowcast',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          input: {
            userQuestion: 'best storm to spot currently?',
          },
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
          runId: 'run-3',
          model: 'gemini-3.1-pro-preview',
          timestamp: 2,
          finishReason: 'tool_calls',
        },
      ]),
    )

    const streamed: Array<any> = []
    for await (const chunk of streamGeminiWithToolContext({
      adapter: { model: 'gemini-3.1-pro-preview' },
      answerTone: 'casual',
      classification: analysisOnlySevereClassification,
      messages: [
        {
          role: 'user',
          content: 'best storm to spot currently?',
        },
      ],
      tools: [
        {
          name: 'derive_radar_nowcast',
        },
      ],
      systemPrompt: 'You are RainCheck.',
      conversationId: 'conv-3',
      middleware: [],
      recoverToolResults: async () => [],
    })) {
      streamed.push(chunk)
    }

    const outputText = streamed
      .filter((chunk) => chunk.type === 'TEXT_MESSAGE_CONTENT')
      .map((chunk) => String(chunk.content ?? chunk.delta ?? ''))
      .join('')

    expect(chatMock).toHaveBeenCalledTimes(1)
    expect(outputText).toContain(
      "I don't have enough live severe-weather data yet to make a confident setup call. Check back after the next radar or model update.",
    )
    expect(outputText).not.toContain(
      'Why RainCheck thinks that: Radar Nowcast evidence for Columbus',
    )
  })
})

describe('streamValidatedSevereWeatherResponse', () => {
  it('suppresses refusal-like chase answers and replaces them with recovered weather guidance', async () => {
    const refusalText =
      'I cannot provide guidance for storm chasing or intercepting tornadoes because these activities carry extreme risks to life and property.'
    const streamed: Array<any> = []

    for await (const chunk of streamValidatedSevereWeatherResponse({
      stream: streamChunks([
        {
          type: 'RUN_STARTED',
          runId: 'run-refusal',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'TEXT_MESSAGE_START',
          messageId: 'msg-refusal',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          role: 'assistant',
        },
        {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'msg-refusal',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          delta: refusalText,
          content: refusalText,
        },
        {
          type: 'TEXT_MESSAGE_END',
          messageId: 'msg-refusal',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'RUN_FINISHED',
          runId: 'run-refusal',
          model: 'gemini-3.1-pro-preview',
          timestamp: 2,
          finishReason: 'stop',
        },
      ]),
      answerTone: 'casual',
      classification: severeClassification,
      route: {
        provider: 'gemini',
        model: 'gemini-3.1-pro-preview',
      },
      latestText:
        'im in yorkville il whats the best plan to follow these upcoming storms to chase a tornado. what time and where should i start the chase',
      recoverToolResults: async () => [
        {
          toolCallId: 'recovery-synthesis',
          toolName: 'synthesize_weather_conclusion',
          result: {
            bottomLine:
              'From Yorkville, start near the Yorkville-to-Morris corridor during the late afternoon and adjust with radar trends before storms cluster farther east.',
            confidence: {
              level: 'medium',
              reason:
                'The severe corridor and timing window are supported, but the first tornadic supercell corridor can still wobble.',
            },
            mostLikelyScenario:
              'The best chase window favors late afternoon into early evening with the first discrete storms west to southwest of Yorkville.',
            agreementSummary:
              'Short-range guidance and severe context agree on a late-afternoon to early-evening window.',
            keyConflicts: [
              'The first mature supercell corridor can still shift if boundaries move.',
            ],
            bustRisks: ['Storms could cluster faster than expected.'],
            recommendedCards: [],
            recommendedArtifacts: [],
            citations: [],
          },
        },
      ],
    })) {
      streamed.push(chunk)
    }

    const outputText = streamed
      .filter((chunk) => chunk.type === 'TEXT_MESSAGE_CONTENT')
      .map((chunk) => String(chunk.content ?? chunk.delta ?? ''))
      .join('')

    expect(outputText).toContain('From Yorkville, start near the Yorkville-to-Morris corridor')
    expect(outputText).not.toContain(refusalText)
    expect(
      streamed.some(
        (chunk) =>
          chunk.type === 'TOOL_CALL_END' &&
          chunk.toolName === 'synthesize_weather_conclusion',
      ),
    ).toBe(true)
  })

  it('replaces derivation-only severe-weather answers when synthesis never ran', async () => {
    const recoverToolResults = vi.fn(async () => [
      {
        toolCallId: 'recovery-synthesis',
        toolName: 'synthesize_weather_conclusion',
        result: {
          bottomLine:
            'The current storm-scale evidence near Columbus is still too conditional to support one best storm target yet.',
          confidence: {
            level: 'medium',
            reason:
              'Radar and mesoscale support show active storms, but mergers and boundary placement still limit storm-specific precision.',
          },
          mostLikelyScenario:
            'A few stronger cells remain possible near the eastern Columbus corridor, but the dominant storm can still change quickly.',
          keyConflicts: [
            'Storm mergers or radar sampling gaps could change the strongest object quickly.',
          ],
        },
      },
    ])
    const streamed: Array<any> = []

    for await (const chunk of streamValidatedSevereWeatherResponse({
      stream: streamChunks([
        {
          type: 'RUN_STARTED',
          runId: 'run-derivation-only',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'TEXT_MESSAGE_START',
          messageId: 'msg-derivation-only',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          role: 'assistant',
        },
        {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'msg-derivation-only',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          delta:
            'Why RainCheck thinks that: Radar Nowcast evidence for Columbus, Ohio, United States is led by NEXRAD, MRMS; nexrad is the most repeated source family with direct upstream support.',
          content:
            'Why RainCheck thinks that: Radar Nowcast evidence for Columbus, Ohio, United States is led by NEXRAD, MRMS; nexrad is the most repeated source family with direct upstream support.',
        },
        {
          type: 'TEXT_MESSAGE_END',
          messageId: 'msg-derivation-only',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'TOOL_CALL_END',
          toolCallId: 'tool-derive',
          toolName: 'derive_radar_nowcast',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          input: {
            userQuestion: 'best storm to spot currently?',
          },
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
          runId: 'run-derivation-only',
          model: 'gemini-3.1-pro-preview',
          timestamp: 2,
          finishReason: 'stop',
        },
      ]),
      answerTone: 'casual',
      classification: severeClassification,
      route: {
        provider: 'gemini',
        model: 'gemini-3.1-pro-preview',
      },
      latestText: 'best storm to spot currently?',
      recoverToolResults,
    })) {
      streamed.push(chunk)
    }

    const outputText = streamed
      .filter((chunk) => chunk.type === 'TEXT_MESSAGE_CONTENT')
      .map((chunk) => String(chunk.content ?? chunk.delta ?? ''))
      .join('')

    expect(recoverToolResults).toHaveBeenCalledTimes(1)
    expect(outputText).toContain(
      'The current storm-scale evidence near Columbus is still too conditional to support one best storm target yet.',
    )
    expect(outputText).not.toContain(
      'Why RainCheck thinks that: Radar Nowcast evidence for Columbus',
    )
    expect(
      streamed.some(
        (chunk) =>
          chunk.type === 'TOOL_CALL_END' &&
          chunk.toolName === 'synthesize_weather_conclusion',
      ),
    ).toBe(true)
  })

  it('passes through supported severe-weather answers without invoking recovery', async () => {
    const recoverToolResults = vi.fn(async () => [])
    const streamed: Array<any> = []

    for await (const chunk of streamValidatedSevereWeatherResponse({
      stream: streamChunks([
        {
          type: 'RUN_STARTED',
          runId: 'run-pass',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'TEXT_MESSAGE_START',
          messageId: 'msg-pass',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          role: 'assistant',
        },
        {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'msg-pass',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          delta:
            'From Yorkville, the best-supported call is to stage west to southwest of town for the late-afternoon window and stay flexible on the exact corridor.',
          content:
            'From Yorkville, the best-supported call is to stage west to southwest of town for the late-afternoon window and stay flexible on the exact corridor.',
        },
        {
          type: 'TEXT_MESSAGE_END',
          messageId: 'msg-pass',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'TOOL_CALL_END',
          toolCallId: 'tool-pass-synthesis',
          toolName: 'synthesize_weather_conclusion',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          result: JSON.stringify({
            bottomLine:
              'From Yorkville, the best-supported call is to stage west to southwest of town for the late-afternoon window and stay flexible on the exact corridor.',
            confidence: {
              level: 'medium',
              reason:
                'The corridor is supported by current severe context and the latest short-range evidence.',
            },
          }),
        },
        {
          type: 'RUN_FINISHED',
          runId: 'run-pass',
          model: 'gemini-3.1-pro-preview',
          timestamp: 2,
          finishReason: 'stop',
        },
      ]),
      answerTone: 'casual',
      classification: severeClassification,
      route: {
        provider: 'gemini',
        model: 'gemini-3.1-pro-preview',
      },
      latestText: 'What is the severe setup near Yorkville tonight?',
      recoverToolResults,
    })) {
      streamed.push(chunk)
    }

    const outputText = streamed
      .filter((chunk) => chunk.type === 'TEXT_MESSAGE_CONTENT')
      .map((chunk) => String(chunk.content ?? chunk.delta ?? ''))
      .join('')

    expect(outputText).toContain('best-supported call is to stage west to southwest of town')
    expect(recoverToolResults).not.toHaveBeenCalled()
  })

  it('uses the short limitation message when recovery cannot synthesize beyond derivation-only severe output', async () => {
    const streamed: Array<any> = []

    for await (const chunk of streamValidatedSevereWeatherResponse({
      stream: streamChunks([
        {
          type: 'RUN_STARTED',
          runId: 'run-derive-no-recovery',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'TEXT_MESSAGE_START',
          messageId: 'msg-derive-no-recovery',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          role: 'assistant',
        },
        {
          type: 'TEXT_MESSAGE_CONTENT',
          messageId: 'msg-derive-no-recovery',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
          delta:
            'Why RainCheck thinks that: Radar Nowcast evidence for Columbus, Ohio, United States is led by NEXRAD, MRMS; nexrad is the most repeated source family with direct upstream support.',
          content:
            'Why RainCheck thinks that: Radar Nowcast evidence for Columbus, Ohio, United States is led by NEXRAD, MRMS; nexrad is the most repeated source family with direct upstream support.',
        },
        {
          type: 'TEXT_MESSAGE_END',
          messageId: 'msg-derive-no-recovery',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'TOOL_CALL_END',
          toolCallId: 'tool-derive-only',
          toolName: 'derive_radar_nowcast',
          model: 'gemini-3.1-pro-preview',
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
          runId: 'run-derive-no-recovery',
          model: 'gemini-3.1-pro-preview',
          timestamp: 2,
          finishReason: 'stop',
        },
      ]),
      answerTone: 'casual',
      classification: severeClassification,
      route: {
        provider: 'gemini',
        model: 'gemini-3.1-pro-preview',
      },
      latestText: 'best storm to spot currently?',
      recoverToolResults: async () => [],
    })) {
      streamed.push(chunk)
    }

    const outputText = streamed
      .filter((chunk) => chunk.type === 'TEXT_MESSAGE_CONTENT')
      .map((chunk) => String(chunk.content ?? chunk.delta ?? ''))
      .join('')

    expect(outputText).toContain(
      "I don't have enough live severe-weather data yet to call a starting corridor. Check back after the next radar or model update.",
    )
    expect(outputText).not.toContain(
      'Why RainCheck thinks that: Radar Nowcast evidence for Columbus',
    )
  })

  it('falls back to a short data-limitation message when recovery cannot build a better answer', async () => {
    const streamed: Array<any> = []

    for await (const chunk of streamValidatedSevereWeatherResponse({
      stream: streamChunks([
        {
          type: 'RUN_STARTED',
          runId: 'run-empty',
          model: 'gemini-3.1-pro-preview',
          timestamp: 1,
        },
        {
          type: 'RUN_FINISHED',
          runId: 'run-empty',
          model: 'gemini-3.1-pro-preview',
          timestamp: 2,
          finishReason: 'stop',
        },
      ]),
      answerTone: 'casual',
      classification: severeClassification,
      route: {
        provider: 'gemini',
        model: 'gemini-3.1-pro-preview',
      },
      latestText:
        'im in yorkville il whats the best plan to follow these upcoming storms to chase a tornado. what time and where should i start the chase',
      recoverToolResults: async () => [],
    })) {
      streamed.push(chunk)
    }

    const outputText = streamed
      .filter((chunk) => chunk.type === 'TEXT_MESSAGE_CONTENT')
      .map((chunk) => String(chunk.content ?? chunk.delta ?? ''))
      .join('')

    expect(outputText).toContain(
      "I don't have enough live severe-weather data yet to call a starting corridor. Check back after the next radar or model update.",
    )
    expect(outputText).not.toContain('cannot provide guidance for storm chasing')
  })
})
