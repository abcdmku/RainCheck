import {
  appSettingsSchema,
  clearProviderConnectionSchema,
  type ProviderId,
  providerConnectionStateSchema,
  providerIdSchema,
  updateAppSettingsSchema,
  updateProviderConnectionSchema,
} from '@raincheck/contracts'
import { eq, inArray } from 'drizzle-orm'

import type { FastifyInstance } from 'fastify'
import type { ProviderRouteState } from '../ai/provider-routing'
import { providerCredentialsTable, settingsTable } from '../db/schema'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import { nowIso } from '../lib/time'

const SETTINGS_ROW_ID = 'local-user'

const providerIds: Array<ProviderId> = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
]

const defaultSettings = appSettingsSchema.parse({
  theme: 'dark',
  units: 'imperial',
  answerTone: 'casual',
  timeDisplay: 'user-local',
  defaultLocationLabel: null,
  allowDeviceLocation: false,
  providerPreferences: [],
  shareByDefault: false,
})

export type StoredProviderConnection = {
  providerId: ProviderId
  mode: 'api-key'
  apiKey: string
  updatedAt: string
}

function envKeyForProvider(app: FastifyInstance, providerId: ProviderId) {
  switch (providerId) {
    case 'openai':
      return app.raincheckEnv.OPENAI_API_KEY
    case 'anthropic':
      return app.raincheckEnv.ANTHROPIC_API_KEY
    case 'gemini':
      return app.raincheckEnv.GEMINI_API_KEY
    case 'openrouter':
      return app.raincheckEnv.OPENROUTER_API_KEY
  }
}

export async function getSettings(app: FastifyInstance) {
  const [row] = await app.raincheckDb
    .select()
    .from(settingsTable)
    .where(eq(settingsTable.id, SETTINGS_ROW_ID))

  if (!row) {
    const now = nowIso()
    await app.raincheckDb.insert(settingsTable).values({
      id: SETTINGS_ROW_ID,
      settingsJson: JSON.stringify(defaultSettings),
      createdAt: now,
      updatedAt: now,
    })
    return defaultSettings
  }

  return appSettingsSchema.parse(JSON.parse(row.settingsJson))
}

export async function updateSettings(app: FastifyInstance, input: unknown) {
  const patch = updateAppSettingsSchema.parse(input)
  const current = await getSettings(app)
  const next = appSettingsSchema.parse({
    ...current,
    ...patch,
    providerPreferences:
      patch.providerPreferences ?? current.providerPreferences,
  })
  const now = nowIso()

  await app.raincheckDb
    .insert(settingsTable)
    .values({
      id: SETTINGS_ROW_ID,
      settingsJson: JSON.stringify(next),
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: settingsTable.id,
      set: {
        settingsJson: JSON.stringify(next),
        updatedAt: now,
      },
    })

  return next
}

export async function updateProviderConnection(
  app: FastifyInstance,
  input: unknown,
) {
  const parsed = updateProviderConnectionSchema.parse(input)
  const now = nowIso()
  const encryptedValue = encryptSecret(
    parsed.apiKey,
    app.raincheckEnv.APP_ENCRYPTION_KEY,
  )

  await app.raincheckDb
    .insert(providerCredentialsTable)
    .values({
      id: parsed.providerId,
      providerId: parsed.providerId,
      encryptedValue,
      mode: parsed.mode,
      model: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: providerCredentialsTable.id,
      set: {
        encryptedValue,
        mode: parsed.mode,
        model: null,
        updatedAt: now,
      },
    })

  return parsed
}

export async function clearProviderConnection(
  app: FastifyInstance,
  input: unknown,
) {
  const parsed = clearProviderConnectionSchema.parse(input)
  await app.raincheckDb
    .delete(providerCredentialsTable)
    .where(eq(providerCredentialsTable.providerId, parsed.providerId))
}

export async function getStoredProviderConnectionMap(app: FastifyInstance) {
  const rows = await app.raincheckDb.select().from(providerCredentialsTable)
  const legacyRowIds = rows
    .filter((row) => row.mode === 'local-cli')
    .map((row) => row.id)

  if (legacyRowIds.length > 0) {
    await app.raincheckDb
      .delete(providerCredentialsTable)
      .where(inArray(providerCredentialsTable.id, legacyRowIds))
  }

  return Object.fromEntries(
    rows
      .filter((row) => row.mode === 'api-key')
      .map((row) => {
        const providerId = providerIdSchema.parse(row.providerId)

        return [
          providerId,
          {
            providerId,
            mode: 'api-key',
            apiKey: decryptSecret(
              row.encryptedValue,
              app.raincheckEnv.APP_ENCRYPTION_KEY,
            ),
            updatedAt: row.updatedAt,
          } satisfies StoredProviderConnection,
        ]
      }),
  ) as Partial<Record<ProviderId, StoredProviderConnection>>
}

export async function getProviderConnectionStates(app: FastifyInstance) {
  const storedMap = await getStoredProviderConnectionMap(app)

  return Promise.all(
    providerIds.map(async (providerId) => {
      const stored = storedMap[providerId]
      const sharedKey = envKeyForProvider(app, providerId)

      if (stored?.mode === 'api-key') {
        return providerConnectionStateSchema.parse({
          providerId,
          mode: 'api-key',
          configured: true,
          available: Boolean(stored.apiKey),
          model: null,
          updatedAt: stored.updatedAt,
          localCli: null,
        })
      }

      if (sharedKey) {
        return providerConnectionStateSchema.parse({
          providerId,
          mode: 'env',
          configured: true,
          available: true,
          model: null,
          updatedAt: null,
          localCli: null,
        })
      }

      return providerConnectionStateSchema.parse({
        providerId,
        mode: 'none',
        configured: false,
        available: false,
        model: null,
        updatedAt: null,
        localCli: null,
      })
    }),
  )
}

export async function getAvailableProviders(app: FastifyInstance) {
  const states = await getProviderConnectionStates(app)
  return states
    .filter((state) => state.available)
    .map((state) => state.providerId)
}

function defaultModelForProvider(providerId: ProviderId) {
  switch (providerId) {
    case 'anthropic':
      return 'claude-sonnet-4-5'
    case 'gemini':
      return 'gemini-2.5-flash'
    case 'openrouter':
      return 'openai/gpt-4.1-mini'
    default:
      return 'gpt-4.1-mini'
  }
}

export async function getProviderRouteStateMap(app: FastifyInstance) {
  const connectionStates = await getProviderConnectionStates(app)

  return Object.fromEntries(
    connectionStates
      .filter((state) => state.available)
      .map((state) => {
        return [
          state.providerId,
          {
            available: state.available,
            defaultModel: defaultModelForProvider(state.providerId),
            transport: 'api',
            source: state.mode === 'env' ? 'shared-env' : 'local-api-key',
          } satisfies ProviderRouteState,
        ]
      }),
  ) as Partial<Record<ProviderId, ProviderRouteState>>
}

export async function getStoredApiKeyMap(app: FastifyInstance) {
  const connections = await getStoredProviderConnectionMap(app)

  return Object.fromEntries(
    Object.entries(connections)
      .filter((entry): entry is [ProviderId, StoredProviderConnection] =>
        Boolean(entry[1]),
      )
      .filter(([, connection]) => connection.mode === 'api-key')
      .map(([providerId, connection]) => [
        providerId,
        {
          apiKey: connection.apiKey,
        },
      ]),
  ) as Partial<Record<ProviderId, { apiKey: string }>>
}
