import type { RainCheckEnv } from '@raincheck/config'
import { describe, expect, it } from 'vitest'

import { chooseRoute } from './provider-routing'

const baseEnv: RainCheckEnv = {
  NODE_ENV: 'test',
  RAINCHECK_APP_URL: 'http://localhost:3000',
  API_BASE_URL: 'http://localhost:3001',
  WEATHER_SERVICE_URL: 'http://localhost:8000',
  DB_URL: ':memory:',
  ARTIFACTS_DIR: './artifacts/generated',
  APP_ENCRYPTION_KEY: '12345678901234567890123456789012',
  OPENAI_API_KEY: 'shared-openai',
  ANTHROPIC_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
  OPENROUTER_API_KEY: undefined,
  DEFAULT_CHAT_PROVIDER: 'openai',
  DEFAULT_CHAT_MODEL: 'gpt-4.1-mini',
  DEFAULT_RESEARCH_PROVIDER: 'openai',
  DEFAULT_RESEARCH_MODEL: 'gpt-4.1',
  DEFAULT_VISION_PROVIDER: 'openai',
  DEFAULT_VISION_MODEL: 'gpt-4.1-mini',
  NWS_USER_AGENT: 'RainCheck Test',
  GEONAMES_USERNAME: undefined,
  ECMWF_DATASTORE_PAT: undefined,
  NCEI_CDO_TOKEN: undefined,
  RAINCHECK_PYTHON_BIN: undefined,
}

describe('chooseRoute', () => {
  it('uses the task-specific default when available', () => {
    const route = chooseRoute({
      env: {
        ...baseEnv,
        DEFAULT_RESEARCH_PROVIDER: 'anthropic',
        DEFAULT_RESEARCH_MODEL: 'claude-sonnet-4-5',
      },
      taskClass: 'research',
      providerStates: {
        anthropic: {
          available: true,
          defaultModel: 'claude-sonnet-4-5',
          transport: 'api',
          source: 'shared-env',
        },
      },
    })

    expect(route.provider).toBe('anthropic')
    expect(route.model).toBe('claude-sonnet-4-5')
    expect(route.transport).toBe('api')
  })

  it('falls back cleanly when only one provider exists', () => {
    const route = chooseRoute({
      env: {
        ...baseEnv,
        OPENAI_API_KEY: undefined,
        ANTHROPIC_API_KEY: undefined,
        GEMINI_API_KEY: 'gemini-key',
        DEFAULT_CHAT_PROVIDER: 'openai',
      },
      taskClass: 'chat',
      providerStates: {
        gemini: {
          available: true,
          defaultModel: 'gemini-2.5-flash',
          transport: 'api',
          source: 'shared-env',
        },
      },
    })

    expect(route.provider).toBe('gemini')
  })

  it('uses saved API-key metadata when that provider is selected', () => {
    const route = chooseRoute({
      env: {
        ...baseEnv,
        OPENAI_API_KEY: undefined,
      },
      taskClass: 'chat',
      providerStates: {
        openai: {
          available: true,
          defaultModel: 'gpt-4.1-mini',
          transport: 'api',
          source: 'local-api-key',
        },
      },
    })

    expect(route.provider).toBe('openai')
    expect(route.transport).toBe('api')
    expect(route.source).toBe('local-api-key')
    expect(route.model).toBe('gpt-4.1-mini')
  })
})
