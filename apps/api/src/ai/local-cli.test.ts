import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'

const execFileMock = vi.fn()
const spawnMock = vi.fn()

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}))

function createClaudeSpawnResponse(input: {
  stdout: string
  assertArgs?: (args: Array<string>) => void
  assertPrompt?: (prompt: string) => void
}) {
  return (file: string, args: Array<string>) => {
    expect(file).toBe('claude')
    input.assertArgs?.(args)

    const child = new EventEmitter() as EventEmitter & {
      stdin: PassThrough
      stdout: PassThrough
      stderr: PassThrough
      kill: ReturnType<typeof vi.fn>
    }
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let prompt = ''

    stdin.on('data', (chunk) => {
      prompt += String(chunk)
    })
    stdin.on('finish', () => {
      input.assertPrompt?.(prompt)
      stdout.end(input.stdout)
      stderr.end()
      setImmediate(() => {
        child.emit('close', 0)
      })
    })

    child.stdin = stdin
    child.stdout = stdout
    child.stderr = stderr
    child.kill = vi.fn()

    return child
  }
}

const { streamLocalCliResponse } = await import('./local-cli')
const dataTool = {
  name: 'get_current_conditions',
  description: 'Fetch current conditions.',
  inputSchema: {
    parse(value: unknown) {
      return value
    },
  },
  async execute(args: any, context?: any) {
    context?.emitCustomEvent?.('tool-progress', {
      label: 'Fetching current conditions',
    })

    return {
      summary: `Current conditions for ${String(args.locationQuery)}`,
      citations: [],
    }
  },
}
const synthesisTool = {
  name: 'synthesize_weather_conclusion',
  description: 'Synthesize the weather conclusion.',
  inputSchema: {
    parse(value: unknown) {
      return value
    },
  },
  async execute() {
    return {
      bottomLine: 'Rain arrives after sunset.',
      citations: [],
    }
  },
}
const severeContextTool = {
  name: 'get_severe_context',
  description: 'Fetch severe context.',
  inputSchema: {
    parse(value: any) {
      return {
        locationQuery: value?.locationQuery ?? 'United States',
        timeHorizonHours: value?.timeHorizonHours ?? 240,
      }
    },
  },
  async execute(args: any, context?: any) {
    context?.emitCustomEvent?.('tool-progress', {
      label: 'Fetching severe-weather context',
    })

    return {
      summary: `SPC severe context for ${String(args.locationQuery)} keeps parts of the Midwest in the broader severe corridor later this week.`,
      citations: [],
    }
  },
}

describe('streamLocalCliResponse', () => {
  it('runs the planner, executes RainCheck tools, and buffers the final CLI answer', async () => {
    execFileMock.mockReset()
    spawnMock.mockReset()
    spawnMock
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout: JSON.stringify({
            toolCalls: [
              {
                toolName: 'get_current_conditions',
                args: { locationQuery: 'Austin, TX' },
              },
            ],
          }),
          assertArgs(args) {
            const toolsIndex = args.indexOf('--tools')

            expect(args).toContain('--print')
            expect(toolsIndex).toBeGreaterThan(-1)
            expect(args[toolsIndex + 1]).toBe('')
            expect(
              args.some((value) =>
                value.includes('Will it rain tonight in Austin, TX?'),
              ),
            ).toBe(false)
          },
          assertPrompt(prompt) {
            expect(prompt).toContain('Will it rain tonight in Austin, TX?')
            expect(prompt).toContain('Allowed tools:')
          },
        }),
      )
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout: JSON.stringify({
            toolCalls: [
              {
                toolName: 'synthesize_weather_conclusion',
                args: { workflow: 'current-conditions' },
              },
            ],
          }),
          assertPrompt(prompt) {
            expect(prompt).toContain(
              'Trusted RainCheck tool results already collected for this turn:',
            )
          },
        }),
      )
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout: 'Rain arrives after sunset.',
          assertPrompt(prompt) {
            expect(prompt).toContain(
              'Write the final RainCheck assistant reply for the user.',
            )
            expect(prompt).toContain('Trusted RainCheck tool results:')
          },
        }),
      )

    const stream = streamLocalCliResponse({
      route: {
        provider: 'anthropic',
        model: 'sonnet',
      },
      classification: {
        taskClass: 'chat',
        intent: 'current-conditions',
        timeHorizonHours: 6,
        locationRequired: true,
        needsArtifact: false,
        chaseGuidanceLevel: 'analysis-only',
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
      },
      messages: [
        {
          role: 'user',
          content: 'Will it rain tonight in Austin, TX?',
        },
      ],
      tools: [dataTool as any, synthesisTool as any],
      systemPrompt: 'Answer weather questions clearly.',
    })

    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(execFileMock).not.toHaveBeenCalled()
    expect(spawnMock).toHaveBeenCalledTimes(3)
    expect(
      chunks.some(
        (chunk: any) =>
          chunk.type === 'TOOL_CALL_END' &&
          chunk.toolName === 'get_current_conditions',
      ),
    ).toBe(true)
    expect(
      chunks.some(
        (chunk: any) =>
          chunk.type === 'TOOL_CALL_END' &&
          chunk.toolName === 'synthesize_weather_conclusion',
      ),
    ).toBe(true)
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'TEXT_MESSAGE_CONTENT',
        content: 'Rain arrives after sunset.',
      }),
    )
  })

  it('replaces missing-data final replies with the supported RainCheck fallback text', async () => {
    execFileMock.mockReset()
    spawnMock.mockReset()
    spawnMock
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout: JSON.stringify({
            toolCalls: [
              {
                toolName: 'get_current_conditions',
                args: { locationQuery: 'Chicago, IL' },
              },
            ],
          }),
        }),
      )
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout: JSON.stringify({
            toolCalls: [
              {
                toolName: 'synthesize_weather_conclusion',
                args: { workflow: 'severe-weather' },
              },
            ],
          }),
        }),
      )
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout:
            "I don't have the forecast details for this week in what you shared here, so I can't tell you where the better storm chances are without guessing.",
        }),
      )

    const stream = streamLocalCliResponse({
      route: {
        provider: 'anthropic',
        model: 'sonnet',
      },
      classification: {
        taskClass: 'research',
        intent: 'severe-weather',
        timeHorizonHours: 72,
        locationRequired: true,
        needsArtifact: false,
        chaseGuidanceLevel: 'analysis-only',
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
      },
      messages: [
        {
          role: 'user',
          content: 'check day 2 and 3 of spc for chicago',
        },
      ],
      tools: [
        dataTool as any,
        {
          ...synthesisTool,
          async execute() {
            return {
              bottomLine:
                'The SPC Day 2 and Day 3 outlooks keep northern Illinois in the broader severe corridor later this week.',
              citations: [],
            }
          },
        } as any,
      ],
      systemPrompt: 'Answer weather questions clearly.',
    })

    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'TEXT_MESSAGE_CONTENT',
        content:
          'The SPC Day 2 and Day 3 outlooks keep northern Illinois in the broader severe corridor later this week.',
      }),
    )
    expect(
      chunks.some(
        (chunk: any) =>
          chunk.type === 'TEXT_MESSAGE_CONTENT' &&
          String(chunk.content).includes("I don't have the forecast details"),
      ),
    ).toBe(false)
  })

  it('falls back to core severe-weather tools when the planner returns no data calls', async () => {
    execFileMock.mockReset()
    spawnMock.mockReset()
    spawnMock
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout: JSON.stringify({
            toolCalls: [],
          }),
        }),
      )
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout:
            "I don't have the forecast details for this week in what you shared here, so I can't tell you where the better storm chances are without guessing.",
        }),
      )

    const stream = streamLocalCliResponse({
      route: {
        provider: 'anthropic',
        model: 'sonnet',
      },
      classification: {
        taskClass: 'research',
        intent: 'severe-weather',
        timeHorizonHours: 240,
        locationRequired: false,
        needsArtifact: false,
        chaseGuidanceLevel: 'analysis-only',
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
      },
      messages: [
        {
          role: 'user',
          content: 'any good storms this week?',
        },
      ],
      tools: [severeContextTool as any],
      systemPrompt: 'Answer weather questions clearly.',
    })

    const chunks = []
    for await (const chunk of stream) {
      chunks.push(chunk)
    }

    expect(
      chunks.some(
        (chunk: any) =>
          chunk.type === 'TOOL_CALL_END' &&
          chunk.toolName === 'get_severe_context',
      ),
    ).toBe(true)
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: 'TEXT_MESSAGE_CONTENT',
        content:
          'SPC severe context for United States keeps parts of the Midwest in the broader severe corridor later this week.',
      }),
    )
  })
})
