import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const requiredEnv = {
  NODE_ENV: 'test',
  RAINCHECK_APP_URL: 'http://localhost:3000',
  API_BASE_URL: 'http://localhost:3001',
  WEATHER_SERVICE_URL: 'http://localhost:8000',
  DB_URL: ':memory:',
  ARTIFACTS_DIR: './artifacts/generated',
  APP_ENCRYPTION_KEY: '12345678901234567890123456789012',
  OPENAI_API_KEY: '',
  DEFAULT_CHAT_PROVIDER: 'openai',
  DEFAULT_CHAT_MODEL: 'gpt-4.1-mini',
  DEFAULT_RESEARCH_PROVIDER: 'openai',
  DEFAULT_RESEARCH_MODEL: 'gpt-4.1',
  DEFAULT_VISION_PROVIDER: 'openai',
  DEFAULT_VISION_MODEL: 'gpt-4.1-mini',
  NWS_USER_AGENT: 'RainCheck Test',
}

const { buildApp } = await import('../app')
const {
  clearProviderConnection,
  getProviderConnectionStates,
  getProviderRouteStateMap,
  getStoredProviderConnectionMap,
  updateProviderConnection,
} = await import('./settings-service')
const { providerCredentialsTable } = await import('../db/schema')

describe('settings-service provider connections', () => {
  let app: ReturnType<typeof buildApp>

  beforeAll(() => {
    Object.assign(process.env, requiredEnv)
    app = buildApp({
      weatherServiceCheck: async () => false,
    })
  })

  afterAll(async () => {
    await app.close()
  })

  it('stores saved API-key connections and routes them as API transport', async () => {
    await updateProviderConnection(app, {
      providerId: 'openai',
      mode: 'api-key',
      apiKey: 'openai-local-key',
    })

    const states = await getProviderConnectionStates(app)
    const openaiState = states.find((state) => state.providerId === 'openai')
    const providerRoutes = await getProviderRouteStateMap(app)
    const storedConnections = await getStoredProviderConnectionMap(app)

    expect(openaiState).toMatchObject({
      providerId: 'openai',
      mode: 'api-key',
      configured: true,
      available: true,
      model: null,
      localCli: null,
    })
    expect(providerRoutes.openai).toMatchObject({
      available: true,
      defaultModel: 'gpt-4.1-mini',
      transport: 'api',
      source: 'local-api-key',
    })
    expect(storedConnections.openai).toMatchObject({
      providerId: 'openai',
      mode: 'api-key',
      apiKey: 'openai-local-key',
    })
  })

  it('ignores and cleans up legacy server-side local CLI rows', async () => {
    await clearProviderConnection(app, {
      providerId: 'openai',
    })
    await app.raincheckDb.insert(providerCredentialsTable).values({
      id: 'openai',
      providerId: 'openai',
      encryptedValue: 'legacy',
      mode: 'local-cli',
      model: 'gpt-5',
      createdAt: '2026-03-28T00:00:00.000Z',
      updatedAt: '2026-03-28T00:00:00.000Z',
    })

    const states = await getProviderConnectionStates(app)
    const openaiState = states.find((state) => state.providerId === 'openai')
    const storedConnections = await getStoredProviderConnectionMap(app)

    expect(openaiState).toMatchObject({
      providerId: 'openai',
      mode: 'none',
      configured: false,
      available: false,
      model: null,
      localCli: null,
    })
    expect(storedConnections.openai).toBeUndefined()
  })
})
