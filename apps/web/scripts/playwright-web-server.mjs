import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(__dirname, '..')
const apiPort = 43101
const webPort = 4184
const logDir = resolve(appRoot, '.playwright')
const logFile = resolve(logDir, 'mock-api.log')

mkdirSync(logDir, { recursive: true })
writeFileSync(logFile, '')

function now() {
  return new Date().toISOString()
}

function logRequest(request, note = '') {
  const line = `${now()} ${request.method ?? 'GET'} ${request.url ?? '/'} origin=${request.headers.origin ?? '-'} ${note}\n`
  appendFileSync(logFile, line)
}

function seedConversation(id, title) {
  const timestamp = now()
  return {
    conversation: {
      id,
      title,
      createdAt: timestamp,
      updatedAt: timestamp,
      latestPreview: null,
    },
    messages: [],
  }
}

function makeSvgDataUri(label, sublabel) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
    <defs>
      <linearGradient id="bg" x1="0" x2="1" y1="0" y2="1">
        <stop offset="0%" stop-color="#13242a" />
        <stop offset="100%" stop-color="#0a1216" />
      </linearGradient>
    </defs>
    <rect width="640" height="360" rx="28" fill="url(#bg)" />
    <circle cx="528" cy="92" r="78" fill="#79ddd0" opacity="0.18" />
    <circle cx="118" cy="268" r="88" fill="#ffd47a" opacity="0.12" />
    <text x="34" y="54" fill="#eef5f5" font-family="sans-serif" font-size="28" font-weight="700">${label}</text>
    <text x="34" y="86" fill="#9cb0b4" font-family="sans-serif" font-size="15">${sublabel}</text>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const conversations = new Map([
  ['thread-weather', seedConversation('thread-weather', 'Austin weather')],
  ['thread-research', seedConversation('thread-research', 'Austin severe setup')],
])

let nextConversationId = 1
let shuttingDown = false

function applyCors(response) {
  response.setHeader('access-control-allow-origin', 'http://127.0.0.1:4184')
  response.setHeader('access-control-allow-credentials', 'true')
  response.setHeader(
    'access-control-allow-methods',
    'GET,POST,PUT,DELETE,OPTIONS',
  )
  response.setHeader(
    'access-control-allow-headers',
    'content-type, authorization',
  )
}

function writeJson(response, statusCode, payload) {
  applyCors(response)
  response.writeHead(statusCode, {
    'content-type': 'application/json',
  })
  response.end(JSON.stringify(payload))
}

function writeHtml(response, html) {
  applyCors(response)
  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
  })
  response.end(html)
}

function writeSse(response, text) {
  const timestamp = Date.now()
  const body = [
    `data: ${JSON.stringify({
      type: 'TEXT_MESSAGE_CONTENT',
      messageId: 'assistant-stream',
      model: 'gpt-4.1-mini',
      timestamp,
      delta: text,
    })}`,
    '',
    `data: ${JSON.stringify({
      type: 'RUN_FINISHED',
      runId: `run-${timestamp}`,
      model: 'gpt-4.1-mini',
      timestamp: timestamp + 1,
      finishReason: 'stop',
    })}`,
    '',
    'data: [DONE]',
    '',
  ].join('\n')

  applyCors(response)
  response.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  })
  response.end(body)
}

async function readJsonBody(request) {
  const chunks = []

  for await (const chunk of request) {
    chunks.push(chunk)
  }

  const body = Buffer.concat(chunks).toString('utf8')
  return body ? JSON.parse(body) : {}
}

function upsertCurrentWeatherReply(entry, conversationId, prompt) {
  const timestamp = now()
  entry.conversation.latestPreview =
    'Current conditions for Austin are 72 F and clear.'
  entry.conversation.updatedAt = timestamp
  entry.messages.push({
    id: `msg-user-${entry.messages.length + 1}`,
    conversationId,
    role: 'user',
    content: prompt,
    parts: [{ type: 'text', content: prompt }],
    citations: [],
    artifacts: [],
    createdAt: timestamp,
    provider: null,
    model: null,
  })
  entry.messages.push({
    id: `msg-assistant-${entry.messages.length + 1}`,
    conversationId,
    role: 'assistant',
    content: 'Current conditions for Austin are 72 F and clear.',
    parts: [
      {
        type: 'text',
        content: 'Current conditions for Austin are 72 F and clear.',
      },
      {
        type: 'tool-call',
        id: 'tool-current-1',
        name: 'get_current_conditions',
        arguments: '{}',
        state: 'input-complete',
        output: {
          location: { name: 'Austin, TX' },
          temperature: { value: 72, unit: 'F' },
          wind: { speed: 8, direction: 'SE' },
          textDescription: 'Clear',
        },
      },
    ],
    citations: [],
    artifacts: [],
    createdAt: timestamp,
    provider: 'openai',
    model: 'gpt-4.1-mini',
  })
}

function upsertConclusionReply(entry, conversationId, prompt) {
  const timestamp = now()
  entry.conversation.latestPreview = 'Bottom line: Austin has a conditional severe setup.'
  entry.conversation.updatedAt = timestamp
  entry.messages.push({
    id: `msg-user-${entry.messages.length + 1}`,
    conversationId,
    role: 'user',
    content: prompt,
    parts: [{ type: 'text', content: prompt }],
    citations: [],
    artifacts: [],
    createdAt: timestamp,
    provider: null,
    model: null,
  })
  entry.messages.push({
    id: `msg-assistant-${entry.messages.length + 1}`,
    conversationId,
    role: 'assistant',
    content:
      'Bottom line: Austin has a conditional severe setup this evening. Confidence: medium.',
    parts: [
      {
        type: 'text',
        content:
          'Bottom line: Austin has a conditional severe setup this evening. Confidence: medium.',
      },
      {
        type: 'tool-call',
        id: 'tool-artifact-1',
        name: 'synthesize_weather_conclusion',
        arguments: '{}',
        state: 'input-complete',
        output: {
          bottomLine: 'A narrow boundary near Austin is the best severe-weather focus.',
          confidence: 'medium',
          confidenceReason:
            'Confidence is medium because the boundary is present but timing still wobbles.',
          mostLikelyScenario:
            'Isolated storms form near the boundary and remain the best target for a short window.',
          alternateScenarios: [
            'Storms stay elevated and remain messy with a lower-end threat.',
            'The boundary shifts south and the best focus moves away from Austin.',
          ],
          keySignals: [
            'SPC and short-range guidance both support a conditional evening target.',
            'Current imagery suggests the boundary is still in play.',
          ],
          conflicts: ['Model timing remains a little faster than the observed trend.'],
          whatWouldChangeTheForecast:
            'Earlier cloud clearing and stronger boundary recovery would increase confidence.',
          recommendedArtifacts: [
            {
              title: 'SPC severe context',
              summary: 'Official severe-weather context for the setup.',
              href: '/api/artifacts/spc-context.html',
              mimeType: 'image/svg+xml',
              imageUrl: makeSvgDataUri('SPC', 'Severe context'),
              imageAlt: 'SPC severe context preview',
              sourceLabel: 'SPC',
            },
            {
              title: 'Radar and nowcast',
              summary: 'The most relevant single-product nowcast view for the target area.',
              href: '/api/artifacts/radar-nowcast.html',
              mimeType: 'image/svg+xml',
              imageUrl: makeSvgDataUri('Radar', 'Nowcast'),
              imageAlt: 'Radar and nowcast preview',
              sourceLabel: 'Nowcast',
            },
          ],
        },
      },
    ],
    citations: [],
    artifacts: [],
    createdAt: timestamp,
    provider: 'openai',
    model: 'gpt-4.1-mini',
  })
}

const apiServer = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
  logRequest(request)

  if (request.method === 'OPTIONS') {
    applyCors(response)
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/settings') {
    writeJson(response, 200, {
      settings: {
        theme: 'dark',
        units: 'imperial',
        answerTone: 'casual',
        timeDisplay: 'user-local',
        defaultLocationLabel: 'Austin, TX',
        allowDeviceLocation: false,
        providerPreferences: [],
        providerConnections: [
          {
            providerId: 'openai',
            mode: 'env',
            configured: true,
            available: true,
            model: null,
            updatedAt: null,
            localCli: null,
          },
          {
            providerId: 'anthropic',
            mode: 'none',
            configured: false,
            available: false,
            model: null,
            updatedAt: null,
            localCli: null,
          },
          {
            providerId: 'gemini',
            mode: 'none',
            configured: false,
            available: false,
            model: null,
            updatedAt: null,
            localCli: null,
          },
          {
            providerId: 'openrouter',
            mode: 'none',
            configured: false,
            available: false,
            model: null,
            updatedAt: null,
            localCli: null,
          },
        ],
        availableProviders: ['openai', 'anthropic', 'gemini'],
        shareByDefault: false,
      },
    })
    return
  }

  if (request.method === 'GET' && url.pathname === '/api/conversations') {
    writeJson(response, 200, {
      conversations: [...conversations.values()].map(
        (entry) => entry.conversation,
      ),
    })
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/conversations') {
    const body = await readJsonBody(request)
    const id = `thread-${nextConversationId++}`
    const entry = seedConversation(id, body.title ?? 'New weather thread')
    conversations.set(id, entry)
    writeJson(response, 200, { conversation: entry.conversation })
    return
  }

  if (url.pathname.startsWith('/api/conversations/')) {
    const id = url.pathname.split('/').at(-1) ?? ''
    const entry = conversations.get(id)

    if (request.method === 'DELETE') {
      if (!entry) {
        writeJson(response, 404, { error: 'Conversation not found' })
        return
      }

      conversations.delete(id)
      applyCors(response)
      response.writeHead(204)
      response.end()
      return
    }

    if (request.method === 'GET') {
      if (!entry) {
        writeJson(response, 404, { error: 'Conversation not found' })
        return
      }

      writeJson(response, 200, entry)
      return
    }
  }

  if (request.method === 'GET' && url.pathname.startsWith('/api/artifacts/')) {
    writeHtml(
      response,
      '<html><body><h1>Research report for Austin, TX</h1><p>Artifact preview</p></body></html>',
    )
    return
  }

  if (request.method === 'POST' && url.pathname === '/api/chat') {
    const body = await readJsonBody(request)
    const conversationId = String(
      body.conversationId ?? body.data?.conversationId ?? '',
    )
    const entry = conversations.get(conversationId)

    if (!entry) {
      writeJson(response, 404, { error: 'Conversation not found' })
      return
    }

    const messages = Array.isArray(body.messages) ? body.messages : []
    const latestUserMessage = messages.at(-1)
    const prompt =
      latestUserMessage?.parts?.find?.((part) => part.type === 'text')
        ?.content ??
      latestUserMessage?.content ??
      'Tell me about the weather.'

    if (/compare|research|brief|radar|target|severe|tornado|storm/i.test(prompt)) {
      upsertConclusionReply(entry, conversationId, prompt)
      writeSse(
        response,
        'Bottom line: Austin has a conditional severe setup this evening. Confidence: medium.',
      )
      return
    }

    upsertCurrentWeatherReply(entry, conversationId, prompt)
    writeSse(response, 'Current conditions for Austin are 72 F and clear.')
    return
  }

  writeJson(response, 404, { error: 'Not found' })
})

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
}

async function closeApiServer() {
  await new Promise((resolve) => {
    apiServer.close(() => resolve())
  })
}

const viteLaunch =
  process.platform === 'win32'
    ? {
        command: process.env.ComSpec ?? 'cmd.exe',
        args: [
          '/c',
          'pnpm',
          'exec',
          'vite',
          'dev',
          '--host',
          '127.0.0.1',
          '--port',
          String(webPort),
          '--strictPort',
        ],
      }
    : {
        command: 'pnpm',
        args: [
          'exec',
          'vite',
          'dev',
          '--host',
          '127.0.0.1',
          '--port',
          String(webPort),
          '--strictPort',
        ],
      }

const vite = spawn(viteLaunch.command, viteLaunch.args, {
  cwd: appRoot,
  env: {
    ...process.env,
    API_BASE_URL: `http://127.0.0.1:${apiPort}`,
  },
  stdio: 'inherit',
})

async function shutdown(exitCode = 0) {
  if (shuttingDown) {
    return
  }

  shuttingDown = true
  vite.kill('SIGTERM')
  await closeApiServer()
  process.exit(exitCode)
}

vite.on('exit', async (code) => {
  await shutdown(code ?? 0)
})

process.on('SIGINT', () => {
  void shutdown(0)
})

process.on('SIGTERM', () => {
  void shutdown(0)
})

await listen(apiServer, apiPort)
