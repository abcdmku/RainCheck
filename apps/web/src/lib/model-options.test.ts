import { describe, expect, it } from 'vitest'
import { getAvailableModelOptions } from './model-options'

describe('getAvailableModelOptions', () => {
  it('includes the full Gemini text model set', () => {
    const options = getAvailableModelOptions({
      availableProviders: ['gemini'],
      providerConnections: [
        {
          providerId: 'gemini',
          mode: 'env',
          configured: true,
          available: true,
          model: null,
          updatedAt: null,
          localCli: null,
        },
      ],
    })

    expect(options).toEqual([
      expect.objectContaining({
        id: 'gemini-3.1-pro-preview',
        label: 'Gemini 3.1 Pro',
        model: 'gemini-3.1-pro-preview',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-3.1-flash-lite-preview',
        label: 'Gemini 3.1 Flash-Lite',
        model: 'gemini-3.1-flash-lite-preview',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-3-flash-preview',
        label: 'Gemini 3 Flash',
        model: 'gemini-3-flash-preview',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-2.5-flash',
        label: 'Gemini 2.5 Flash',
        model: 'gemini-2.5-flash',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-2.5-pro',
        label: 'Gemini 2.5 Pro',
        model: 'gemini-2.5-pro',
        provider: 'gemini',
      }),
      expect.objectContaining({
        id: 'gemini-2.5-flash-lite',
        label: 'Gemini 2.5 Flash-Lite',
        model: 'gemini-2.5-flash-lite',
        provider: 'gemini',
      }),
    ])
  })

  it('adds native desktop local CLI models when Codex is authenticated', () => {
    const options = getAvailableModelOptions({
      availableProviders: ['openai'],
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
      ],
      desktopProviderConnections: [
        {
          providerId: 'openai',
          connected: true,
          configured: true,
          model: null,
          updatedAt: null,
          localCli: {
            command: 'codex',
            detected: true,
            authReady: true,
            authMethod: 'ChatGPT',
            subscriptionType: null,
            statusLabel: 'Ready via ChatGPT',
          },
        },
      ],
    })

    expect(options).toContainEqual(
      expect.objectContaining({
        label: 'GPT-5.4',
        model: 'gpt-5.4',
        provider: 'openai',
        providerLabel: 'OpenAI via Codex',
        transport: 'local-cli',
        source: 'desktop-local-cli',
      }),
    )
    expect(options).toContainEqual(
      expect.objectContaining({
        label: 'GPT-5.4 Mini',
        model: 'gpt-5.4-mini',
        provider: 'openai',
        providerLabel: 'OpenAI via Codex',
        transport: 'local-cli',
        source: 'desktop-local-cli',
      }),
    )
    expect(options).toContainEqual(
      expect.objectContaining({
        label: 'GPT-4.1 Mini',
        model: 'gpt-4.1-mini',
        provider: 'openai',
        transport: 'api',
      }),
    )
  })
})
