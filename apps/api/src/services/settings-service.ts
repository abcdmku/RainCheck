import {
  appSettingsSchema,
  byokStateSchema,
  clearProviderKeySchema,
  providerIdSchema,
  storeProviderKeySchema,
  updateAppSettingsSchema,
} from '@raincheck/contracts'
import { eq } from 'drizzle-orm'

import type { FastifyInstance } from 'fastify'
import { providerCredentialsTable, settingsTable } from '../db/schema'
import { decryptSecret, encryptSecret } from '../lib/crypto'
import { nowIso } from '../lib/time'

const SETTINGS_ROW_ID = 'local-user'

const defaultSettings = appSettingsSchema.parse({
  theme: 'dark',
  units: 'imperial',
  defaultLocationLabel: null,
  allowDeviceLocation: false,
  providerPreferences: [],
  byok: [],
  shareByDefault: false,
})

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
    byok: patch.byok ?? current.byok,
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

export async function storeProviderKey(app: FastifyInstance, input: unknown) {
  const parsed = storeProviderKeySchema.parse(input)
  const now = nowIso()
  await app.raincheckDb
    .insert(providerCredentialsTable)
    .values({
      id: parsed.providerId,
      providerId: parsed.providerId,
      encryptedValue: encryptSecret(
        parsed.apiKey,
        app.raincheckEnv.APP_ENCRYPTION_KEY,
      ),
      useByok: parsed.useByok,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: providerCredentialsTable.id,
      set: {
        encryptedValue: encryptSecret(
          parsed.apiKey,
          app.raincheckEnv.APP_ENCRYPTION_KEY,
        ),
        useByok: parsed.useByok,
        updatedAt: now,
      },
    })

  return parsed
}

export async function clearProviderKey(app: FastifyInstance, input: unknown) {
  const parsed = clearProviderKeySchema.parse(input)
  await app.raincheckDb
    .delete(providerCredentialsTable)
    .where(eq(providerCredentialsTable.providerId, parsed.providerId))
}

export async function getProviderKeyMap(app: FastifyInstance) {
  const rows = await app.raincheckDb.select().from(providerCredentialsTable)
  return Object.fromEntries(
    rows.map((row) => [
      providerIdSchema.parse(row.providerId),
      {
        apiKey: decryptSecret(
          row.encryptedValue,
          app.raincheckEnv.APP_ENCRYPTION_KEY,
        ),
        useByok: row.useByok,
      },
    ]),
  )
}

export async function getByokState(app: FastifyInstance) {
  const rows = await app.raincheckDb.select().from(providerCredentialsTable)
  return rows.map((row) =>
    byokStateSchema.parse({
      providerId: row.providerId,
      configured: true,
      useByok: row.useByok,
      updatedAt: row.updatedAt,
    }),
  )
}
