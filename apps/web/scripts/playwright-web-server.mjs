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

const conversations = new Map([
  ['thread-weather', seedConversation('thread-weather', 'Austin weather')],
  ['thread-research', seedConversation('thread-research', 'Austin research')],
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

function upsertResearchReply(entry, conversationId, prompt) {
  const timestamp = now()
  entry.conversation.latestPreview = 'Research brief ready for Austin, TX.'
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
    content: 'Research brief ready for Austin, TX.',
    parts: [
      {
        type: 'text',
        content: 'Research brief ready for Austin, TX.',
      },
      {
        type: 'tool-call',
        id: 'tool-artifact-1',
        name: 'generate_artifact',
        arguments: '{}',
        state: 'input-complete',
        output: {
          artifactId: 'research-report.html',
          title: 'Research report for Austin, TX',
          href: '/api/artifacts/research-report.html',
          mimeType: 'text/html',
        },
      },
    ],
    citations: [],
    artifacts: [
      {
        id: 'research-report.html',
        type: 'report',
        title: 'Research report for Austin, TX',
        description: 'Research report',
        mimeType: 'text/html',
        href: '/api/artifacts/research-report.html',
        createdAt: timestamp,
        sourceIds: ['weather-gov'],
      },
    ],
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
        defaultLocationLabel: 'Austin, TX',
        allowDeviceLocation: false,
        providerPreferences: [],
        byok: [],
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

    if (/compare|research|brief|radar/i.test(prompt)) {
      upsertResearchReply(entry, conversationId, prompt)
      writeSse(response, 'Research brief ready for Austin, TX.')
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
