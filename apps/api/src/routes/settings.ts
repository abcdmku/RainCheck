import {
  clearProviderKeySchema,
  storeProviderKeySchema,
} from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import {
  clearProviderKey,
  getByokState,
  getProviderKeyMap,
  getSettings,
  storeProviderKey,
  updateSettings,
} from '../services/settings-service'

const providerIds = ['openai', 'anthropic', 'gemini', 'openrouter'] as const

async function getAvailableProviders(app: FastifyInstance) {
  const keyMap = await getProviderKeyMap(app)

  return providerIds.filter((providerId) => {
    switch (providerId) {
      case 'openai':
        return Boolean(app.raincheckEnv.OPENAI_API_KEY || keyMap.openai?.apiKey)
      case 'anthropic':
        return Boolean(
          app.raincheckEnv.ANTHROPIC_API_KEY || keyMap.anthropic?.apiKey,
        )
      case 'gemini':
        return Boolean(app.raincheckEnv.GEMINI_API_KEY || keyMap.gemini?.apiKey)
      case 'openrouter':
        return Boolean(
          app.raincheckEnv.OPENROUTER_API_KEY || keyMap.openrouter?.apiKey,
        )
    }
  })
}

async function buildSettingsPayload(
  app: FastifyInstance,
  settingsInput?: Awaited<ReturnType<typeof getSettings>>,
) {
  const settings = settingsInput ?? (await getSettings(app))

  return {
    ...settings,
    byok: await getByokState(app),
    availableProviders: await getAvailableProviders(app),
  }
}

export async function registerSettingsRoutes(app: FastifyInstance) {
  app.get('/api/settings', async () => {
    return { settings: await buildSettingsPayload(app) }
  })

  app.put('/api/settings', async (request) => {
    const settings = await updateSettings(app, request.body ?? {})
    return { settings: await buildSettingsPayload(app, settings) }
  })

  app.post('/api/settings/byok', async (request) => {
    const parsed = storeProviderKeySchema.parse(request.body)
    await storeProviderKey(app, parsed)
    return { ok: true }
  })

  app.delete('/api/settings/byok/:providerId', async (request) => {
    const params = request.params as { providerId: string }
    await clearProviderKey(
      app,
      clearProviderKeySchema.parse({ providerId: params.providerId }),
    )
    return { ok: true }
  })
}
