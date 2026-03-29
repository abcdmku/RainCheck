import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  LocalCliDiagnostics,
  ProviderId,
  RequestClassification,
} from '@raincheck/contracts'
import { localCliDiagnosticsSchema } from '@raincheck/contracts'
import type { ServerTool, StreamChunk } from '@tanstack/ai'
import { normalizeTimingLanguage } from '../weather/timing-language'

type LocalCliProviderId = Extract<ProviderId, 'openai' | 'anthropic'>

type ToolCallPlan = {
  toolCalls: Array<{
    toolName: string
    args: Record<string, unknown>
  }>
}

type ExecutedToolResult = {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
  result: unknown
}

const localCliTimeoutMs = 90_000
const promptResultCharLimit = 8_000
const toolPlanSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    toolCalls: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          toolName: {
            type: 'string',
          },
          args: {
            type: 'object',
            additionalProperties: true,
          },
        },
        required: ['toolName', 'args'],
      },
      default: [],
    },
  },
  required: ['toolCalls'],
} as const

function isLocalCliProvider(
  providerId: ProviderId,
): providerId is LocalCliProviderId {
  return providerId === 'openai' || providerId === 'anthropic'
}

function commandForProvider(providerId: LocalCliProviderId) {
  return providerId === 'openai' ? 'codex' : 'claude'
}

function execFileCapture(
  file: string,
  args: Array<string>,
  options: {
    timeout?: number
    maxBuffer?: number
  } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        const enrichedError = Object.assign(error, {
          stdout,
          stderr,
        })
        reject(enrichedError)
        return
      }

      resolve({
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      })
    })
  })
}

function spawnCapture(input: {
  file: string
  args: Array<string>
  stdinText?: string
  timeout?: number
  maxBuffer?: number
  label: string
}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(input.file, input.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const maxBuffer = input.maxBuffer ?? Number.POSITIVE_INFINITY
    let stdout = ''
    let stderr = ''
    let settled = false

    const finishReject = (error: Error) => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      reject(
        Object.assign(error, {
          stdout,
          stderr,
        }),
      )
    }

    const finishResolve = () => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timer)
      resolve({
        stdout,
        stderr,
      })
    }

    const appendOutput = (
      key: 'stdout' | 'stderr',
      chunk: string | Buffer<ArrayBufferLike>,
    ) => {
      const nextValue = `${key === 'stdout' ? stdout : stderr}${String(chunk)}`

      if (Buffer.byteLength(nextValue, 'utf8') > maxBuffer) {
        child.kill()
        finishReject(new Error(`${input.label} output exceeded maxBuffer`))
        return
      }

      if (key === 'stdout') {
        stdout = nextValue
        return
      }

      stderr = nextValue
    }

    const timer = setTimeout(() => {
      child.kill()
      finishReject(new Error(`${input.label} timed out`))
    }, input.timeout ?? localCliTimeoutMs)

    child.stdout.on('data', (chunk) => {
      appendOutput('stdout', chunk)
    })
    child.stderr.on('data', (chunk) => {
      appendOutput('stderr', chunk)
    })
    child.stdin.on('error', (error) => {
      const errorCode = (error as NodeJS.ErrnoException).code
      if (settled || errorCode === 'EPIPE') {
        return
      }

      finishReject(error)
    })
    child.on('error', (error) => {
      finishReject(error)
    })
    child.on('close', (code) => {
      if (code === 0) {
        finishResolve()
        return
      }

      finishReject(
        new Error(
          stderr.trim() ||
            `${input.label} exited with code ${String(code ?? 'unknown')}`,
        ),
      )
    })

    child.stdin.end(input.stdinText ?? '')
  })
}

function missingCommandDiagnostics(
  providerId: LocalCliProviderId,
): LocalCliDiagnostics {
  const command = commandForProvider(providerId)

  return localCliDiagnosticsSchema.parse({
    command,
    detected: false,
    authReady: false,
    authMethod: null,
    subscriptionType: null,
    statusLabel:
      providerId === 'openai'
        ? 'Codex CLI not found on PATH'
        : 'Claude CLI not found on PATH',
  })
}

function notReadyDiagnostics(
  providerId: LocalCliProviderId,
  statusLabel: string,
  authMethod: string | null = null,
  subscriptionType: string | null = null,
) {
  return localCliDiagnosticsSchema.parse({
    command: commandForProvider(providerId),
    detected: true,
    authReady: false,
    authMethod,
    subscriptionType,
    statusLabel,
  })
}

function readyDiagnostics(input: {
  providerId: LocalCliProviderId
  authMethod: string | null
  statusLabel: string
  subscriptionType?: string | null
}) {
  return localCliDiagnosticsSchema.parse({
    command: commandForProvider(input.providerId),
    detected: true,
    authReady: true,
    authMethod: input.authMethod,
    subscriptionType: input.subscriptionType ?? null,
    statusLabel: input.statusLabel,
  })
}

async function readCodexDiagnostics() {
  try {
    const { stdout } = await execFileCapture('codex', ['login', 'status'], {
      timeout: 5_000,
    })
    const output = stdout.trim()
    const match = output.match(/^Logged in using (.+)$/i)

    if (match) {
      return readyDiagnostics({
        providerId: 'openai',
        authMethod: match[1].trim(),
        statusLabel: `Ready via ${match[1].trim()}`,
      })
    }

    if (output) {
      return readyDiagnostics({
        providerId: 'openai',
        authMethod: null,
        statusLabel: output,
      })
    }

    return notReadyDiagnostics('openai', 'Codex CLI login status unavailable')
  } catch (error: any) {
    const message = String(
      error?.stderr ?? error?.stdout ?? error?.message ?? '',
    )
    if (error?.code === 'ENOENT') {
      return missingCommandDiagnostics('openai')
    }

    return notReadyDiagnostics(
      'openai',
      message.trim() || 'Codex CLI is installed but not logged in',
    )
  }
}

async function readClaudeDiagnostics() {
  try {
    const { stdout } = await execFileCapture('claude', ['auth', 'status'], {
      timeout: 5_000,
    })
    const output = stdout.trim()
    if (!output) {
      return notReadyDiagnostics(
        'anthropic',
        'Claude Code auth status unavailable',
      )
    }

    const parsed = JSON.parse(output) as {
      loggedIn?: boolean
      authMethod?: string
      subscriptionType?: string
    }

    if (parsed.loggedIn) {
      const authMethod = parsed.authMethod ?? null
      const subscriptionType = parsed.subscriptionType ?? null
      const statusSuffix = subscriptionType
        ? `${authMethod ?? 'authenticated'} (${subscriptionType})`
        : (authMethod ?? 'authenticated')

      return readyDiagnostics({
        providerId: 'anthropic',
        authMethod,
        subscriptionType,
        statusLabel: `Ready via ${statusSuffix}`,
      })
    }

    return notReadyDiagnostics(
      'anthropic',
      'Claude Code is installed but not logged in',
      parsed.authMethod ?? null,
      parsed.subscriptionType ?? null,
    )
  } catch (error: any) {
    const message = String(
      error?.stderr ?? error?.stdout ?? error?.message ?? '',
    )
    if (error?.code === 'ENOENT') {
      return missingCommandDiagnostics('anthropic')
    }

    return notReadyDiagnostics(
      'anthropic',
      message.trim() || 'Claude Code is installed but not logged in',
    )
  }
}

export async function getLocalCliDiagnostics(
  providerId: ProviderId,
): Promise<LocalCliDiagnostics | null> {
  if (!isLocalCliProvider(providerId)) {
    return null
  }

  switch (providerId) {
    case 'openai':
      return readCodexDiagnostics()
    case 'anthropic':
      return readClaudeDiagnostics()
  }
}

function extractTextContent(message: any) {
  if (!message) {
    return ''
  }

  if (typeof message.content === 'string') {
    return message.content
  }

  if (Array.isArray(message.parts)) {
    return message.parts
      .filter((part: { type?: string }) => part.type === 'text')
      .map((part: { content?: string }) => part.content ?? '')
      .join('')
  }

  return ''
}

function stringifyPromptValue(
  value: unknown,
  maxChars = promptResultCharLimit,
) {
  let serialized = ''
  try {
    serialized =
      typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '')
  } catch {
    serialized = String(value)
  }

  if (serialized.length <= maxChars) {
    return serialized
  }

  return `${serialized.slice(0, maxChars).trimEnd()}\n...`
}

function sanitizeJsonText(value: string) {
  const trimmed = value.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]+?)\s*```/i)
  if (fenced) {
    return fenced[1].trim()
  }

  const firstBrace = trimmed.indexOf('{')
  const lastBrace = trimmed.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return trimmed.slice(firstBrace, lastBrace + 1)
  }

  return trimmed
}

function parseToolPlan(value: string) {
  const sanitized = sanitizeJsonText(value)

  if (!sanitized) {
    return {
      toolCalls: [],
    } satisfies ToolCallPlan
  }

  const parsed = JSON.parse(sanitized) as Partial<ToolCallPlan>
  return {
    toolCalls: Array.isArray(parsed.toolCalls)
      ? parsed.toolCalls.map((entry) => ({
          toolName: String(entry?.toolName ?? '').trim(),
          args:
            entry?.args && typeof entry.args === 'object'
              ? (entry.args as Record<string, unknown>)
              : {},
        }))
      : [],
  } satisfies ToolCallPlan
}

function buildDeterministicDataPlan(input: {
  classification: RequestClassification
  tools: Array<ServerTool<any, any>>
  defaultLocationQuery?: string | null
}) {
  const availableToolNames = new Set(input.tools.map((tool) => tool.name))
  const toolCalls: ToolCallPlan['toolCalls'] = []
  const timeHorizonHours =
    typeof input.classification.timeHorizonHours === 'number' &&
    Number.isFinite(input.classification.timeHorizonHours)
      ? Math.max(
          0,
          Math.min(720, Math.round(input.classification.timeHorizonHours)),
        )
      : 0
  const locationQuery = input.defaultLocationQuery?.trim() || undefined

  const pushToolCall = (toolName: string, args: Record<string, unknown>) => {
    if (
      !availableToolNames.has(toolName) ||
      toolCalls.some((toolCall) => toolCall.toolName === toolName)
    ) {
      return
    }

    toolCalls.push({
      toolName,
      args,
    })
  }

  switch (input.classification.intent) {
    case 'severe-weather':
      pushToolCall('get_severe_context', {
        ...(locationQuery ? { locationQuery } : {}),
        ...(timeHorizonHours > 0 ? { timeHorizonHours } : {}),
      })

      if (locationQuery) {
        pushToolCall('get_forecast', {
          locationQuery,
          horizon: timeHorizonHours >= 48 ? 'extended' : 'short',
        })

        if (timeHorizonHours <= 24) {
          pushToolCall('get_alerts', {
            locationQuery,
          })
        }
      }
      break
    default:
      if (locationQuery) {
        pushToolCall('get_forecast', {
          locationQuery,
          horizon: timeHorizonHours >= 48 ? 'extended' : 'short',
        })
        pushToolCall('get_alerts', {
          locationQuery,
        })

        if (timeHorizonHours <= 24) {
          pushToolCall('get_current_conditions', {
            locationQuery,
          })
        }
      }
      break
  }

  return {
    toolCalls,
  } satisfies ToolCallPlan
}

function mapToolByName(tools: Array<ServerTool<any, any>>) {
  return new Map(tools.map((tool) => [tool.name, tool]))
}

function splitTools(tools: Array<ServerTool<any, any>>) {
  const dataTools: Array<ServerTool<any, any>> = []
  const followUpTools: Array<ServerTool<any, any>> = []

  for (const tool of tools) {
    switch (tool.name) {
      case 'synthesize_weather_conclusion':
      case 'compare_weather_candidates':
      case 'generate_weather_artifact':
        followUpTools.push(tool)
        break
      default:
        dataTools.push(tool)
        break
    }
  }

  return {
    dataTools,
    followUpTools,
  }
}

function formatConversation(messages: Array<any>) {
  return messages
    .map((message) => {
      const text = extractTextContent(message).trim()
      if (!text) {
        return null
      }

      return `${String(message.role ?? 'user').toUpperCase()}: ${text}`
    })
    .filter(Boolean)
    .join('\n')
}

function formatToolCatalog(tools: Array<ServerTool<any, any>>) {
  return tools.map((tool) => `- ${tool.name}: ${tool.description}`).join('\n')
}

function formatToolResults(results: Array<ExecutedToolResult>) {
  return results
    .map((result, index) =>
      [
        `Tool ${index + 1}: ${result.toolName}`,
        `Input: ${stringifyPromptValue(result.input, 2_000)}`,
        `Output: ${stringifyPromptValue(result.result)}`,
      ].join('\n'),
    )
    .join('\n\n')
}

function buildPlannerPrompt(input: {
  phase: 'data' | 'follow-up'
  systemPrompt: string
  classification: RequestClassification
  messages: Array<any>
  tools: Array<ServerTool<any, any>>
  priorResults?: Array<ExecutedToolResult>
}) {
  return [
    'You are planning RainCheck server weather tool calls.',
    'Return JSON only that matches the provided schema.',
    'Do not answer the user directly.',
    'Use only the allowed tool names.',
    input.phase === 'data'
      ? 'Choose the smallest useful set of data-gathering tools for this turn.'
      : 'Choose only conclusion or artifact tools that should run after the fetched weather context.',
    'If the user asks about SPC outlooks, convective outlooks, or Day 1/2/3/4-8 severe products, prefer get_severe_context first.',
    'For severe-weather questions beyond the next two days, prefer derive_global_weather over storm-scale nowcast tools when it is available.',
    '',
    'RainCheck system guidance:',
    input.systemPrompt,
    '',
    'Conversation:',
    formatConversation(input.messages),
    '',
    'Classification:',
    stringifyPromptValue(input.classification, 2_000),
    '',
    'Allowed tools:',
    formatToolCatalog(input.tools),
    ...(input.priorResults?.length
      ? [
          '',
          'Trusted RainCheck tool results already collected for this turn:',
          formatToolResults(input.priorResults),
        ]
      : []),
  ].join('\n')
}

function buildFinalAnswerPrompt(input: {
  systemPrompt: string
  classification: RequestClassification
  messages: Array<any>
  toolResults: Array<ExecutedToolResult>
}) {
  return [
    'Write the final RainCheck assistant reply for the user.',
    'Use the trusted RainCheck tool results below and do not invent missing weather data.',
    'Do not mention tools, JSON, planning, or CLI internals.',
    'If trusted RainCheck tool results are present, never say the data came back empty, nothing usable returned, or that you could not pull it up. Summarize the trusted results directly instead.',
    'Do not ask the user to send forecast details, weather results, or source text when trusted RainCheck tool results are already present.',
    '',
    'RainCheck system guidance:',
    input.systemPrompt,
    '',
    'Conversation:',
    formatConversation(input.messages),
    '',
    'Classification:',
    stringifyPromptValue(input.classification, 2_000),
    '',
    'Trusted RainCheck tool results:',
    formatToolResults(input.toolResults),
  ].join('\n')
}

async function runCodexPrompt(input: {
  model: string
  prompt: string
  schema?: Record<string, unknown>
}) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raincheck-codex-'))
  const outputPath = path.join(tempDir, 'output.txt')
  const schemaPath = path.join(tempDir, 'schema.json')

  try {
    if (input.schema) {
      await writeFile(schemaPath, JSON.stringify(input.schema), 'utf8')
    }

    const args = [
      '--ask-for-approval',
      'never',
      '--sandbox',
      'read-only',
      'exec',
      '--skip-git-repo-check',
      '-C',
      tempDir,
      '--output-last-message',
      outputPath,
    ]

    if (input.schema) {
      args.push('--output-schema', schemaPath)
    }

    args.push('--model', input.model, '-')

    const { stdout } = await spawnCapture({
      file: 'codex',
      args,
      stdinText: input.prompt,
      label: 'Codex CLI',
      timeout: localCliTimeoutMs,
    })

    const outputText = await readFile(outputPath, 'utf8').catch(() => '')

    return outputText.trim() || stdout.trim()
  } finally {
    await rm(tempDir, { recursive: true, force: true })
  }
}

async function runClaudePrompt(input: {
  model: string
  prompt: string
  schema?: Record<string, unknown>
}) {
  const args = ['--print', '--model', input.model, '--tools', '']

  if (input.schema) {
    args.push(
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(input.schema),
    )
  }

  const { stdout } = await spawnCapture({
    file: 'claude',
    args,
    stdinText: input.prompt,
    label: 'Claude CLI',
    timeout: localCliTimeoutMs,
    maxBuffer: 1024 * 1024,
  })

  return stdout.trim()
}

async function runLocalCliPrompt(input: {
  provider: LocalCliProviderId
  model: string
  prompt: string
  schema?: Record<string, unknown>
}) {
  switch (input.provider) {
    case 'openai':
      return runCodexPrompt(input)
    case 'anthropic':
      return runClaudePrompt(input)
  }
}

function buildCustomChunk(
  model: string,
  name: string,
  value: Record<string, unknown>,
): StreamChunk {
  return {
    type: 'CUSTOM',
    name,
    value,
    model,
    timestamp: Date.now(),
  } satisfies StreamChunk
}

function buildToolResultChunk(
  model: string,
  toolResult: ExecutedToolResult,
): StreamChunk {
  return {
    type: 'TOOL_CALL_END',
    toolCallId: toolResult.toolCallId,
    toolName: toolResult.toolName,
    model,
    timestamp: Date.now(),
    input: toolResult.input,
    result: stringifyPromptValue(toolResult.result),
  } satisfies StreamChunk
}

function buildFallbackAnswer(toolResults: Array<ExecutedToolResult>) {
  for (const toolResult of [...toolResults].reverse()) {
    const result = toolResult.result
    if (!result || typeof result !== 'object') {
      continue
    }

    if (typeof (result as any).bottomLine === 'string') {
      return String((result as any).bottomLine)
    }

    if (typeof (result as any).summary === 'string') {
      return String((result as any).summary)
    }

    if (typeof (result as any).mostLikelyScenario === 'string') {
      return String((result as any).mostLikelyScenario)
    }

    if (typeof (result as any).agreementSummary === 'string') {
      return String((result as any).agreementSummary)
    }
  }

  return 'RainCheck could not finish a local CLI response for this turn.'
}

function looksLikeMissingDataAnswer(text: string) {
  const normalized = text.trim()
  if (!normalized) {
    return false
  }

  return [
    /\bwasn't able to pull up\b/i,
    /\bcouldn't pull up\b/i,
    /\bcould not pull up\b/i,
    /\bcame back empty\b/i,
    /\bno [a-z- ]*data came back\b/i,
    /\bdidn't come back with anything usable\b/i,
    /\bnothing usable\b/i,
    /\bunable to fetch\b/i,
    /\bfetch came back empty\b/i,
    /\b(?:i do not|i don't) have (?:the )?(?:forecast|weather) details\b/i,
    /\b(?:can(?:not|'t)) tell you\b[^.?!]*\bwithout guessing\b/i,
    /\bif you send (?:the )?(?:forecast|weather) (?:summary|results)\b/i,
  ].some((pattern) => pattern.test(normalized))
}

function executeToolArgs(
  tool: ServerTool<any, any>,
  args: Record<string, unknown>,
) {
  const schema = tool.inputSchema as
    | { parse?: (value: unknown) => unknown }
    | undefined
  if (schema?.parse) {
    return schema.parse(args) as Record<string, unknown>
  }

  return args
}

async function requestToolPlan(input: {
  provider: LocalCliProviderId
  model: string
  prompt: string
}) {
  const output = await runLocalCliPrompt({
    provider: input.provider,
    model: input.model,
    prompt: input.prompt,
    schema: toolPlanSchema,
  })

  return parseToolPlan(output)
}

async function executePlannedToolCalls(input: {
  model: string
  plan: ToolCallPlan
  toolMap: Map<string, ServerTool<any, any>>
}): Promise<{
  chunks: Array<StreamChunk>
  results: Array<ExecutedToolResult>
}> {
  const chunks: Array<StreamChunk> = []
  const results: Array<ExecutedToolResult> = []

  for (const plannedCall of input.plan.toolCalls) {
    const tool = input.toolMap.get(plannedCall.toolName)
    if (!tool?.execute) {
      throw new Error(
        `Local CLI requested an unknown or unavailable tool: ${plannedCall.toolName}`,
      )
    }

    const parsedArgs = executeToolArgs(tool, plannedCall.args)
    const toolCallId = `local-cli-tool-${results.length + 1}`
    const customEvents: Array<StreamChunk> = []
    const execution = tool.execute(parsedArgs, {
      emitCustomEvent(name, value) {
        customEvents.push(
          buildCustomChunk(input.model, name, value as Record<string, unknown>),
        )
      },
    })

    chunks.push(...customEvents)

    const result = await execution
    const toolResult = {
      toolCallId,
      toolName: plannedCall.toolName,
      input: parsedArgs,
      result,
    } satisfies ExecutedToolResult

    results.push(toolResult)
    chunks.push(buildToolResultChunk(input.model, toolResult))
  }

  return {
    chunks,
    results,
  }
}

export async function* streamLocalCliResponse(input: {
  route: {
    provider: LocalCliProviderId
    model: string
  }
  classification: RequestClassification
  messages: Array<any>
  tools: Array<ServerTool<any, any>>
  systemPrompt: string
}): AsyncIterable<StreamChunk> {
  const model = input.route.model
  const runId = `local-cli-run-${Date.now()}`
  const messageId = `local-cli-message-${Date.now()}`

  yield {
    type: 'RUN_STARTED',
    runId,
    model,
    timestamp: Date.now(),
  } satisfies StreamChunk

  const { dataTools, followUpTools } = splitTools(input.tools)
  const executedToolResults: Array<ExecutedToolResult> = []

  if (dataTools.length > 0) {
    yield buildCustomChunk(model, 'tool-progress', {
      label: 'Planning weather data',
    })

    let dataPlan = await requestToolPlan({
      provider: input.route.provider,
      model,
      prompt: buildPlannerPrompt({
        phase: 'data',
        systemPrompt: input.systemPrompt,
        classification: input.classification,
        messages: input.messages,
        tools: dataTools,
      }),
    })
    if (dataPlan.toolCalls.length === 0) {
      const fallbackPlan = buildDeterministicDataPlan({
        classification: input.classification,
        tools: dataTools,
      })

      if (fallbackPlan.toolCalls.length > 0) {
        dataPlan = fallbackPlan
        yield buildCustomChunk(model, 'tool-progress', {
          label: 'Using fallback weather tools',
        })
      }
    }
    const dataExecution = await executePlannedToolCalls({
      model,
      plan: dataPlan,
      toolMap: mapToolByName(dataTools),
    })

    executedToolResults.push(...dataExecution.results)
    for (const chunk of dataExecution.chunks) {
      yield chunk
    }
  }

  if (followUpTools.length > 0) {
    yield buildCustomChunk(model, 'tool-progress', {
      label: 'Planning weather synthesis',
    })

    const followUpPlan = await requestToolPlan({
      provider: input.route.provider,
      model,
      prompt: buildPlannerPrompt({
        phase: 'follow-up',
        systemPrompt: input.systemPrompt,
        classification: input.classification,
        messages: input.messages,
        tools: followUpTools,
        priorResults: executedToolResults,
      }),
    })
    const followUpExecution = await executePlannedToolCalls({
      model,
      plan: followUpPlan,
      toolMap: mapToolByName(followUpTools),
    })

    executedToolResults.push(...followUpExecution.results)
    for (const chunk of followUpExecution.chunks) {
      yield chunk
    }
  }

  yield buildCustomChunk(model, 'tool-progress', {
    label: 'Writing the answer',
  })

  let finalText = await runLocalCliPrompt({
    provider: input.route.provider,
    model,
    prompt: buildFinalAnswerPrompt({
      systemPrompt: input.systemPrompt,
      classification: input.classification,
      messages: input.messages,
      toolResults: executedToolResults,
    }),
  })

  if (
    !finalText.trim() ||
    (executedToolResults.length > 0 && looksLikeMissingDataAnswer(finalText))
  ) {
    finalText = buildFallbackAnswer(executedToolResults)
  }

  const normalizedText = normalizeTimingLanguage(finalText)

  yield {
    type: 'TEXT_MESSAGE_START',
    messageId,
    model,
    timestamp: Date.now(),
    role: 'assistant',
  } satisfies StreamChunk

  yield {
    type: 'TEXT_MESSAGE_CONTENT',
    messageId,
    model,
    timestamp: Date.now(),
    delta: normalizedText,
    content: normalizedText,
  } satisfies StreamChunk

  yield {
    type: 'TEXT_MESSAGE_END',
    messageId,
    model,
    timestamp: Date.now(),
  } satisfies StreamChunk

  yield {
    type: 'RUN_FINISHED',
    runId,
    model,
    timestamp: Date.now(),
    finishReason: 'stop',
  } satisfies StreamChunk
}
