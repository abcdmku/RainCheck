import type { TaskClass, UserSettings } from '@raincheck/contracts'

import type { RainCheckEnv } from './env'

export type ProviderAvailability = Record<
  'openai' | 'anthropic' | 'gemini' | 'openrouter',
  boolean
>

export function getProviderAvailability(
  env: RainCheckEnv,
  _userSettings?: UserSettings,
): ProviderAvailability {
  return {
    openai: Boolean(env.OPENAI_API_KEY),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
  }
}

export function getDefaultRouteForTask(
  env: RainCheckEnv,
  taskClass: TaskClass,
) {
  switch (taskClass) {
    case 'research':
      return {
        provider: env.DEFAULT_RESEARCH_PROVIDER,
        model: env.DEFAULT_RESEARCH_MODEL,
      }
    case 'vision':
      return {
        provider: env.DEFAULT_VISION_PROVIDER,
        model: env.DEFAULT_VISION_MODEL,
      }
    default:
      return {
        provider: env.DEFAULT_CHAT_PROVIDER,
        model: env.DEFAULT_CHAT_MODEL,
      }
  }
}
