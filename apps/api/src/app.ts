import cors from '@fastify/cors'
import sensible from '@fastify/sensible'
import { parseEnv, type RainCheckEnv } from '@raincheck/config'
import { healthResponseSchema } from '@raincheck/contracts'
import fastify, { type FastifyInstance } from 'fastify'

import { handleChatRequest } from './ai/chat-service'
import { createDb, type RainCheckDb } from './db/client'
import { toAppError } from './lib/errors'
import { registerArtifactRoutes } from './routes/artifacts'
import { registerChatRoutes } from './routes/chat'
import { registerConversationRoutes } from './routes/conversations'
import { registerDesktopLocalCliRoutes } from './routes/desktop-local-cli'
import { registerRuntimeRoutes } from './routes/runtime'
import { registerSettingsRoutes } from './routes/settings'
import { createRuntimeInfo, type RainCheckRuntimeInfo } from './runtime/info'
import { checkWeatherService } from './weather/service-client'

type ChatHandler = (
  app: FastifyInstance,
  body: {
    conversationId: string
    messages: Array<any>
    provider?: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
    model?: string
    displayTimezone?: string
    locationOverride?: {
      label?: string
      latitude?: number
      longitude?: number
      timezone?: string
    }
  },
) => Promise<{
  route: Record<string, unknown>
  classification: Record<string, unknown>
  stream: AsyncIterable<any>
}>
type WeatherServiceCheck = typeof checkWeatherService

declare module 'fastify' {
  interface FastifyInstance {
    raincheckChatHandler: ChatHandler
    raincheckDb: RainCheckDb
    raincheckEnv: RainCheckEnv
    raincheckRuntime: RainCheckRuntimeInfo
    raincheckWeatherServiceCheck: WeatherServiceCheck
  }
}

export function buildApp(
  options: {
    env?: RainCheckEnv
    chatHandler?: ChatHandler
    weatherServiceCheck?: WeatherServiceCheck
  } = {},
) {
  const env = options.env ?? parseEnv(process.env)
  const { db, sqlite } = createDb(env.DB_URL)
  const runtimeInfo = createRuntimeInfo(env)
  const app = fastify({
    logger:
      env.NODE_ENV === 'development'
        ? {
            transport: {
              target: 'pino-pretty',
            },
          }
        : true,
  })

  app.decorate('raincheckEnv', env)
  app.decorate('raincheckDb', db)
  app.decorate('raincheckRuntime', runtimeInfo)
  app.decorate('raincheckChatHandler', options.chatHandler ?? handleChatRequest)
  app.decorate(
    'raincheckWeatherServiceCheck',
    options.weatherServiceCheck ?? checkWeatherService,
  )

  app.register(cors, {
    origin: true,
    credentials: true,
  })
  app.register(sensible)

  app.addHook('onClose', async () => {
    sqlite.close()
  })

  app.setErrorHandler((error, _request, reply) => {
    const appError = toAppError(error)
    reply.status(appError.statusCode).send({
      error: {
        code: appError.code,
        message: appError.message,
        details: appError.details,
      },
    })
  })

  app.get('/health', async () => ({ ok: true }))
  app.get('/api/health', async () => {
    const weatherServiceUp = await app.raincheckWeatherServiceCheck(app)
    return healthResponseSchema.parse({
      ok: true,
      version: '0.1.0',
      services: {
        api: 'up',
        database: 'up',
        weatherService: weatherServiceUp ? 'up' : 'degraded',
      },
    })
  })

  void registerConversationRoutes(app)
  void registerSettingsRoutes(app)
  void registerDesktopLocalCliRoutes(app)
  void registerChatRoutes(app)
  void registerRuntimeRoutes(app)
  void registerArtifactRoutes(app)

  return app
}
