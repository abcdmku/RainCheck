import {
  type AnthropicTextAdapter,
  createAnthropicChat,
} from '@tanstack/ai-anthropic'
import { createGeminiChat, type GeminiTextAdapter } from '@tanstack/ai-gemini'
import { createOpenaiChat, type OpenAITextAdapter } from '@tanstack/ai-openai'

import type { FastifyInstance } from 'fastify'

import { getProviderKeyMap } from '../services/settings-service'

type SupportedAdapter =
  | OpenAITextAdapter<any>
  | AnthropicTextAdapter<any, any, any>
  | GeminiTextAdapter<any, any, any>

export async function buildAdapter(
  app: FastifyInstance,
  decision: {
    provider: 'openai' | 'anthropic' | 'gemini' | 'openrouter'
    model: string
  },
): Promise<SupportedAdapter> {
  const keyMap = await getProviderKeyMap(app)

  switch (decision.provider) {
    case 'anthropic':
      return createAnthropicChat(
        decision.model as any,
        keyMap.anthropic?.apiKey ?? app.raincheckEnv.ANTHROPIC_API_KEY ?? '',
      )
    case 'gemini':
      return createGeminiChat(
        decision.model as any,
        keyMap.gemini?.apiKey ?? app.raincheckEnv.GEMINI_API_KEY ?? '',
      )
    case 'openrouter':
      return createOpenaiChat(
        decision.model as any,
        keyMap.openrouter?.apiKey ?? app.raincheckEnv.OPENROUTER_API_KEY ?? '',
        {
          baseURL: 'https://openrouter.ai/api/v1',
          defaultHeaders: {
            'HTTP-Referer': app.raincheckEnv.RAINCHECK_APP_URL,
            'X-Title': 'RainCheck',
          },
        },
      )
    default:
      return createOpenaiChat(
        decision.model as any,
        keyMap.openai?.apiKey ?? app.raincheckEnv.OPENAI_API_KEY ?? '',
      )
  }
}
