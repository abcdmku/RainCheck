import { EventEmitter } from 'node:events'
import { writeFileSync } from 'node:fs'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileMock = vi.hoisted(() => vi.fn())
const spawnMock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
  spawn: spawnMock,
}))

function createClaudeSpawnResponse(input: {
  stdout: string
  onSpawn?: (file: string, args: Array<string>) => void
  onPrompt?: (prompt: string) => void
}) {
  return (file: string, args: Array<string>) => {
    input.onSpawn?.(file, args)

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
      input.onPrompt?.(prompt)
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

function createCodexSpawnResponse(input: {
  outputText?: string
  stdout?: string
  writeOutputFile?: boolean
  onSpawn?: (file: string, args: Array<string>) => void
  onPrompt?: (prompt: string) => void
}) {
  return (file: string, args: Array<string>) => {
    input.onSpawn?.(file, args)

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
      input.onPrompt?.(prompt)
      const outputPathIndex = args.indexOf('--output-last-message')
      const outputPath = outputPathIndex >= 0 ? args[outputPathIndex + 1] : null

      if (outputPath && input.writeOutputFile !== false) {
        writeFileSync(outputPath, input.outputText ?? '', 'utf8')
      }

      stdout.end(input.stdout ?? '')
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

describe('runDesktopLocalCliChat', () => {
  let runDesktopLocalCliChat: typeof import('./local-cli').runDesktopLocalCliChat
  const fetchMock = vi.fn()
  let platformSpy: ReturnType<typeof vi.spyOn> | null = null

  beforeEach(async () => {
    vi.resetModules()
    execFileMock.mockReset()
    spawnMock.mockReset()
    fetchMock.mockReset()
    platformSpy?.mockRestore()
    platformSpy = null
    vi.stubGlobal('fetch', fetchMock)
    ;({ runDesktopLocalCliChat } = await import('./local-cli'))
  })

  it('sends Anthropic prompts through stdin while keeping tools disabled', async () => {
    let observedFile = ''
    let observedArgs: Array<string> = []
    let observedPrompt = ''

    spawnMock.mockImplementation(
      createClaudeSpawnResponse({
        stdout: 'Storm chances look limited this week.',
        onSpawn(file, args) {
          observedFile = file
          observedArgs = args
        },
        onPrompt(prompt) {
          observedPrompt = prompt
        },
      }),
    )
    execFileMock.mockImplementation(
      (
        file: string,
        args: Array<string>,
        _options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        if (file === 'where.exe' && args[0] === 'claude') {
          callback(null, 'C:\\Users\\Borg\\.local\\bin\\claude.exe\r\n', '')
          return
        }

        if (
          file === 'C:\\Users\\Borg\\.local\\bin\\claude.exe' &&
          args[0] === 'auth' &&
          args[1] === 'status'
        ) {
          callback(
            null,
            JSON.stringify({
              loggedIn: true,
              authMethod: 'subscription',
              subscriptionType: 'pro',
            }),
            '',
          )
          return
        }

        throw new Error(`Unexpected execFile call: ${file} ${args.join(' ')}`)
      },
    )

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/desktop/local-cli/prepare')) {
        return {
          ok: true,
          async json() {
            return {
              session: {
                conversationId: 'conv-1',
                userMessageId: 'msg-user-1',
                providerId: 'anthropic',
                model: 'claude-haiku-4-5',
                route: {
                  provider: 'anthropic',
                  model: 'claude-haiku-4-5',
                },
                classification: {
                  taskClass: 'chat',
                },
                systemPrompt: 'Answer weather questions clearly.',
                messages: [
                  {
                    id: 'msg-user-1',
                    conversationId: 'conv-1',
                    role: 'user',
                    content: 'any good storms this week?',
                    parts: [],
                    citations: [],
                    artifacts: [],
                    createdAt: '2026-03-28T22:12:59.022Z',
                    model: null,
                    provider: null,
                    transport: null,
                    source: null,
                  },
                ],
                toolCatalog: [],
                answerContext: {
                  location: null,
                  units: 'imperial',
                  timeDisplay: 'user-local',
                  answerTone: 'casual',
                  displayTimezone: 'America/Chicago',
                },
              },
            }
          },
        }
      }

      if (url.endsWith('/api/desktop/local-cli/complete')) {
        return {
          ok: true,
          async json() {
            return {
              message: {
                id: 'msg-assistant-1',
                conversationId: 'conv-1',
                role: 'assistant',
                content: 'Storm chances look limited this week.',
                parts: [],
                citations: [],
                artifacts: [],
                createdAt: '2026-03-28T22:13:10.000Z',
                model: 'claude-haiku-4-5',
                provider: 'anthropic',
                transport: 'local-cli',
                source: 'desktop-local-cli',
              },
              citations: [],
              artifacts: [],
            }
          },
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const result = await runDesktopLocalCliChat(
      {
        apiBaseUrl: 'http://localhost:3000',
        conversationId: 'conv-1',
        message: 'any good storms this week?',
        providerId: 'anthropic',
        model: 'claude-haiku-4-5',
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
      {
        emitProgress: vi.fn(),
      },
    )

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(observedFile.toLowerCase()).toContain('claude')
    expect(observedArgs).toContain('--print')
    expect(observedArgs).toContain('--tools')
    expect(observedArgs[observedArgs.indexOf('--tools') + 1]).toBe('')
    expect(
      observedArgs.some((value) => value.includes('Write the final RainCheck')),
    ).toBe(false)
    expect(observedPrompt).toContain(
      'Write the final RainCheck assistant reply for the user.',
    )
    expect(observedPrompt).toContain('USER: any good storms this week?')
    expect(result.message.content).toBe('Storm chances look limited this week.')
  })

  it('sends OpenAI prompts through stdin when Codex resolves to codex.cmd on Windows', async () => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.resetModules()
    ;({ runDesktopLocalCliChat } = await import('./local-cli'))

    let observedFile = ''
    let observedArgs: Array<string> = []
    let observedPrompt = ''

    spawnMock.mockImplementation(
      createCodexSpawnResponse({
        outputText: 'Storm chances look limited this week.',
        onSpawn(file, args) {
          observedFile = file
          observedArgs = args
        },
        onPrompt(prompt) {
          observedPrompt = prompt
        },
      }),
    )
    execFileMock.mockImplementation(
      (
        file: string,
        args: Array<string>,
        _options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        if (file === 'where.exe' && args[0] === 'codex') {
          callback(
            null,
            ['C:\\nvm4w\\nodejs\\codex', 'C:\\nvm4w\\nodejs\\codex.cmd'].join(
              '\r\n',
            ),
            '',
          )
          return
        }

        if (
          file === 'powershell.exe' &&
          args.includes('C:\\nvm4w\\nodejs\\codex.cmd') &&
          args.includes('login') &&
          args.includes('status')
        ) {
          callback(null, '', 'Logged in using ChatGPT')
          return
        }

        throw new Error(`Unexpected execFile call: ${file} ${args.join(' ')}`)
      },
    )

    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith('/api/desktop/local-cli/prepare')) {
        return {
          ok: true,
          async json() {
            return {
              session: {
                conversationId: 'conv-1',
                userMessageId: 'msg-user-1',
                providerId: 'openai',
                model: 'gpt-5.4-mini',
                route: {
                  provider: 'openai',
                  model: 'gpt-5.4-mini',
                },
                classification: {
                  taskClass: 'chat',
                },
                systemPrompt: 'Answer weather questions clearly.',
                messages: [
                  {
                    id: 'msg-user-1',
                    conversationId: 'conv-1',
                    role: 'user',
                    content: 'any good storms this week?',
                    parts: [],
                    citations: [],
                    artifacts: [],
                    createdAt: '2026-03-28T22:12:59.022Z',
                    model: null,
                    provider: null,
                    transport: null,
                    source: null,
                  },
                ],
                toolCatalog: [],
                answerContext: {
                  location: null,
                  units: 'imperial',
                  timeDisplay: 'user-local',
                  answerTone: 'casual',
                  displayTimezone: 'America/Chicago',
                },
              },
            }
          },
        }
      }

      if (url.endsWith('/api/desktop/local-cli/complete')) {
        return {
          ok: true,
          async json() {
            return {
              message: {
                id: 'msg-assistant-1',
                conversationId: 'conv-1',
                role: 'assistant',
                content: 'Storm chances look limited this week.',
                parts: [],
                citations: [],
                artifacts: [],
                createdAt: '2026-03-28T22:13:10.000Z',
                model: 'gpt-5.4-mini',
                provider: 'openai',
                transport: 'local-cli',
                source: 'desktop-local-cli',
              },
              citations: [],
              artifacts: [],
            }
          },
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const result = await runDesktopLocalCliChat(
      {
        apiBaseUrl: 'http://localhost:3000',
        conversationId: 'conv-1',
        message: 'any good storms this week?',
        providerId: 'openai',
        model: 'gpt-5.4-mini',
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
      {
        emitProgress: vi.fn(),
      },
    )

    expect(spawnMock).toHaveBeenCalledTimes(1)
    expect(observedFile).toBe('powershell.exe')
    expect(observedArgs).toContain('C:\\nvm4w\\nodejs\\codex.cmd')
    expect(observedArgs).toContain('exec')
    expect(observedArgs).toContain('-')
    expect(
      observedArgs.some((value) =>
        value.includes('Do not answer the user directly.'),
      ),
    ).toBe(false)
    expect(observedPrompt).toContain(
      'Write the final RainCheck assistant reply for the user.',
    )
    expect(observedPrompt).toContain('USER: any good storms this week?')
    expect(result.message.content).toBe('Storm chances look limited this week.')
  })

  it('falls back to Codex stdout when schema output leaves the file blank', async () => {
    platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    vi.resetModules()
    ;({ runDesktopLocalCliChat } = await import('./local-cli'))

    let executedToolCalls: Array<{
      name: string
      arguments: Record<string, unknown>
    }> = []
    const observedPrompts: Array<string> = []

    spawnMock
      .mockImplementationOnce(
        createCodexSpawnResponse({
          writeOutputFile: false,
          stdout: JSON.stringify({
            toolCalls: [
              {
                name: 'resolve_location',
                arguments: { locationQuery: 'Chicago, IL' },
              },
            ],
          }),
          onPrompt(prompt) {
            observedPrompts.push(prompt)
          },
        }),
      )
      .mockImplementationOnce(
        createCodexSpawnResponse({
          outputText: 'Chicago looks generally quiet today.',
          onPrompt(prompt) {
            observedPrompts.push(prompt)
          },
        }),
      )

    execFileMock.mockImplementation(
      (
        file: string,
        args: Array<string>,
        _options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        if (file === 'where.exe' && args[0] === 'codex') {
          callback(
            null,
            ['C:\\nvm4w\\nodejs\\codex', 'C:\\nvm4w\\nodejs\\codex.cmd'].join(
              '\r\n',
            ),
            '',
          )
          return
        }

        if (
          file === 'powershell.exe' &&
          args.includes('C:\\nvm4w\\nodejs\\codex.cmd') &&
          args.includes('login') &&
          args.includes('status')
        ) {
          callback(null, '', 'Logged in using ChatGPT')
          return
        }

        throw new Error(`Unexpected execFile call: ${file} ${args.join(' ')}`)
      },
    )

    fetchMock.mockImplementation(
      async (url: string, init?: { body?: unknown }) => {
        if (url.endsWith('/api/desktop/local-cli/prepare')) {
          return {
            ok: true,
            async json() {
              return {
                session: {
                  conversationId: 'conv-2',
                  userMessageId: 'msg-user-2',
                  providerId: 'openai',
                  model: 'gpt-5.4-mini',
                  route: {
                    provider: 'openai',
                    model: 'gpt-5.4-mini',
                  },
                  classification: {
                    taskClass: 'chat',
                  },
                  systemPrompt: 'Answer weather questions clearly.',
                  messages: [
                    {
                      id: 'msg-user-2',
                      conversationId: 'conv-2',
                      role: 'user',
                      content: 'how does Chicago look today?',
                      parts: [],
                      citations: [],
                      artifacts: [],
                      createdAt: '2026-03-29T18:00:00.000Z',
                      model: null,
                      provider: null,
                      transport: null,
                      source: null,
                    },
                  ],
                  toolCatalog: [
                    {
                      name: 'resolve_location',
                      description: 'Resolve a location label.',
                      inputSchema: {
                        type: 'object',
                        properties: {
                          locationQuery: {
                            type: 'string',
                          },
                        },
                      },
                    },
                  ],
                  answerContext: {
                    location: null,
                    units: 'imperial',
                    timeDisplay: 'user-local',
                    answerTone: 'casual',
                    displayTimezone: 'America/Chicago',
                  },
                },
              }
            },
          }
        }

        if (url.endsWith('/api/desktop/local-cli/execute-tools')) {
          const body = JSON.parse(String(init?.body ?? '{}')) as {
            toolCalls?: Array<{
              name: string
              arguments: Record<string, unknown>
            }>
          }
          executedToolCalls = body.toolCalls ?? []

          return {
            ok: true,
            async json() {
              return {
                progressEvents: [
                  {
                    type: 'status',
                    label: 'Resolving location',
                  },
                ],
                results: [
                  {
                    name: 'resolve_location',
                    arguments: {
                      locationQuery: 'Chicago, IL',
                    },
                    result: {
                      summary: 'Resolved Chicago, IL',
                    },
                  },
                ],
              }
            },
          }
        }

        if (url.endsWith('/api/desktop/local-cli/complete')) {
          return {
            ok: true,
            async json() {
              return {
                message: {
                  id: 'msg-assistant-2',
                  conversationId: 'conv-2',
                  role: 'assistant',
                  content: 'Chicago looks generally quiet today.',
                  parts: [],
                  citations: [],
                  artifacts: [],
                  createdAt: '2026-03-29T18:00:10.000Z',
                  model: 'gpt-5.4-mini',
                  provider: 'openai',
                  transport: 'local-cli',
                  source: 'desktop-local-cli',
                },
                citations: [],
                artifacts: [],
              }
            },
          }
        }

        throw new Error(`Unexpected fetch call: ${url}`)
      },
    )

    const result = await runDesktopLocalCliChat(
      {
        apiBaseUrl: 'http://localhost:3000',
        conversationId: 'conv-2',
        message: 'how does Chicago look today?',
        providerId: 'openai',
        model: 'gpt-5.4-mini',
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
      {
        emitProgress: vi.fn(),
      },
    )

    expect(spawnMock).toHaveBeenCalledTimes(2)
    expect(executedToolCalls).toEqual([
      {
        name: 'resolve_location',
        arguments: {
          locationQuery: 'Chicago, IL',
        },
      },
    ])
    expect(observedPrompts[0]).toContain('Allowed tools:')
    expect(observedPrompts[1]).toContain('Trusted RainCheck tool results:')
    expect(result.message.content).toBe('Chicago looks generally quiet today.')
  })

  it('recovers from empty planning and limitation-style Claude answers', async () => {
    let spawnCount = 0
    let completedResponseText = ''

    spawnMock.mockImplementation(
      createClaudeSpawnResponse({
        stdout: '',
        onSpawn() {
          spawnCount += 1
        },
        onPrompt() {},
      }),
    )
    spawnMock
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout: JSON.stringify({
            toolCalls: [],
          }),
          onSpawn() {
            spawnCount += 1
          },
        }),
      )
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout: JSON.stringify({
            toolCalls: [
              {
                name: 'synthesize_weather_conclusion',
                arguments: { workflow: 'severe-weather' },
              },
            ],
          }),
          onSpawn() {
            spawnCount += 1
          },
        }),
      )
      .mockImplementationOnce(
        createClaudeSpawnResponse({
          stdout:
            "I don't have the forecast details for this week in what you shared here, so I can't tell you where the better storm chances are without guessing.",
          onSpawn() {
            spawnCount += 1
          },
        }),
      )

    execFileMock.mockImplementation(
      (
        file: string,
        args: Array<string>,
        _options: Record<string, unknown>,
        callback: (error: null, stdout: string, stderr: string) => void,
      ) => {
        if (file === 'where.exe' && args[0] === 'claude') {
          callback(null, 'C:\\Users\\Borg\\.local\\bin\\claude.exe\r\n', '')
          return
        }

        if (
          file === 'C:\\Users\\Borg\\.local\\bin\\claude.exe' &&
          args[0] === 'auth' &&
          args[1] === 'status'
        ) {
          callback(
            null,
            JSON.stringify({
              loggedIn: true,
              authMethod: 'subscription',
              subscriptionType: 'pro',
            }),
            '',
          )
          return
        }

        throw new Error(`Unexpected execFile call: ${file} ${args.join(' ')}`)
      },
    )

    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/desktop/local-cli/prepare')) {
        return {
          ok: true,
          async json() {
            return {
              session: {
                conversationId: 'conv-2',
                userMessageId: 'msg-user-2',
                providerId: 'anthropic',
                model: 'claude-sonnet-4-6',
                route: {
                  provider: 'anthropic',
                  model: 'claude-sonnet-4-6',
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
                systemPrompt: 'Answer weather questions clearly.',
                messages: [
                  {
                    id: 'msg-user-2',
                    conversationId: 'conv-2',
                    role: 'user',
                    content: 'any good storms this week?',
                    parts: [],
                    citations: [],
                    artifacts: [],
                    createdAt: '2026-03-28T22:12:59.022Z',
                    model: null,
                    provider: null,
                    transport: null,
                    source: null,
                  },
                ],
                toolCatalog: [
                  {
                    name: 'get_severe_context',
                    description: 'Fetch severe context.',
                    inputSchema: {},
                  },
                  {
                    name: 'synthesize_weather_conclusion',
                    description: 'Synthesize the weather conclusion.',
                    inputSchema: {},
                  },
                ],
                answerContext: {
                  location: {
                    label: 'Chicago, IL',
                    latitude: 41.8781,
                    longitude: -87.6298,
                  },
                  units: 'imperial',
                  timeDisplay: 'user-local',
                  answerTone: 'casual',
                  displayTimezone: 'America/Chicago',
                },
              },
            }
          },
        }
      }

      if (url.endsWith('/api/desktop/local-cli/execute-tools')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          toolCalls?: Array<{ name: string }>
        }
        const firstTool = body.toolCalls?.[0]?.name

        if (firstTool === 'get_severe_context') {
          return {
            ok: true,
            async json() {
              return {
                progressEvents: [],
                results: [
                  {
                    name: 'get_severe_context',
                    arguments: { locationQuery: 'Chicago, IL' },
                    result: {
                      summary:
                        'SPC Day 3 Convective Outlook: Northern Illinois stays in the broader severe corridor later this week.',
                    },
                  },
                ],
              }
            },
          }
        }

        return {
          ok: true,
          async json() {
            return {
              progressEvents: [],
              results: [
                {
                  name: 'synthesize_weather_conclusion',
                  arguments: { workflow: 'severe-weather' },
                  result: {
                    bottomLine:
                      'The SPC Day 2 and Day 3 outlooks keep northern Illinois in play later this week.',
                  },
                },
              ],
            }
          },
        }
      }

      if (url.endsWith('/api/desktop/local-cli/complete')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          responseText?: string
        }
        completedResponseText = String(body.responseText ?? '')

        return {
          ok: true,
          async json() {
            return {
              message: {
                id: 'msg-assistant-2',
                conversationId: 'conv-2',
                role: 'assistant',
                content: completedResponseText,
                parts: [],
                citations: [],
                artifacts: [],
                createdAt: '2026-03-28T22:13:10.000Z',
                model: 'claude-sonnet-4-6',
                provider: 'anthropic',
                transport: 'local-cli',
                source: 'desktop-local-cli',
              },
              citations: [],
              artifacts: [],
            }
          },
        }
      }

      throw new Error(`Unexpected fetch call: ${url}`)
    })

    const result = await runDesktopLocalCliChat(
      {
        apiBaseUrl: 'http://localhost:3000',
        conversationId: 'conv-2',
        message: 'any good storms this week?',
        providerId: 'anthropic',
        model: 'claude-sonnet-4-6',
        route: {
          transport: 'local-cli',
          source: 'desktop-local-cli',
        },
        context: {
          location: {
            label: 'Chicago, IL',
            latitude: 41.8781,
            longitude: -87.6298,
          },
          units: 'imperial',
          timeDisplay: 'user-local',
          answerTone: 'casual',
          displayTimezone: 'America/Chicago',
        },
      },
      {
        emitProgress: vi.fn(),
      },
    )

    expect(spawnCount).toBe(3)
    expect(completedResponseText).toBe(
      'The SPC Day 2 and Day 3 outlooks keep northern Illinois in play later this week.',
    )
    expect(result.message.content).toBe(
      'The SPC Day 2 and Day 3 outlooks keep northern Illinois in play later this week.',
    )
  })
})
