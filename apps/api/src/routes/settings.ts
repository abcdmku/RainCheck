import {
  clearProviderConnectionSchema,
  updateProviderConnectionSchema,
} from '@raincheck/contracts'
import type { FastifyInstance } from 'fastify'

import {
  clearProviderConnection,
  getAvailableProviders,
  getProviderConnectionStates,
  getSettings,
  updateProviderConnection,
  updateSettings,
} from '../services/settings-service'

async function buildSettingsPayload(
  app: FastifyInstance,
  settingsInput?: Awaited<ReturnType<typeof getSettings>>,
) {
  const settings = settingsInput ?? (await getSettings(app))

  return {
    ...settings,
    providerConnections: await getProviderConnectionStates(app),
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

  app.put('/api/settings/providers/:providerId/connection', async (request) => {
    const params = request.params as { providerId: string }
    const parsed = updateProviderConnectionSchema.parse({
      ...(request.body as Record<string, unknown>),
      providerId: params.providerId,
    })
    await updateProviderConnection(app, parsed)
    return { ok: true }
  })

  app.delete(
    '/api/settings/providers/:providerId/connection',
    async (request) => {
      const params = request.params as { providerId: string }
      await clearProviderConnection(
        app,
        clearProviderConnectionSchema.parse({ providerId: params.providerId }),
      )
      return { ok: true }
    },
  )
}
