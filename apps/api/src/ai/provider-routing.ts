import type { RainCheckEnv } from '@raincheck/config'
import { type AppSettings, routeDecisionSchema } from '@raincheck/contracts'

type ProviderId = 'openai' | 'anthropic' | 'gemini' | 'openrouter'

type ProviderKeyMap = Partial<
  Record<
    ProviderId,
    {
      apiKey: string
      useByok: boolean
    }
  >
>

function availableProviders(env: RainCheckEnv, keyMap: ProviderKeyMap) {
  const shared: Record<ProviderId, boolean> = {
    openai: Boolean(env.OPENAI_API_KEY),
    anthropic: Boolean(env.ANTHROPIC_API_KEY),
    gemini: Boolean(env.GEMINI_API_KEY),
    openrouter: Boolean(env.OPENROUTER_API_KEY),
  }

  return (Object.entries(shared) as Array<[ProviderId, boolean]>)
    .filter(
      ([provider, enabled]) => enabled || Boolean(keyMap[provider]?.apiKey),
    )
    .map(([provider]) => provider)
}

export function chooseRoute(options: {
  env: RainCheckEnv
  taskClass: 'chat' | 'research' | 'vision'
  settings?: AppSettings
  keyMap: ProviderKeyMap
  requestedProvider?: ProviderId
  requestedModel?: string
}) {
  const providers = availableProviders(options.env, options.keyMap)
  if (providers.length === 0) {
    throw new Error(
      'No AI provider is configured. Add one provider key to continue.',
    )
  }

  const taskPreference = options.settings?.providerPreferences.find(
    (preference) =>
      preference.taskClass ===
      (options.taskClass === 'vision' ? 'vision' : options.taskClass),
  )

  const requestedProvider = options.requestedProvider
  const requestedModel = options.requestedModel

  const candidates: Array<{
    provider: ProviderId
    model: string
    reason: string
  }> = []

  if (requestedProvider && requestedModel) {
    candidates.push({
      provider: requestedProvider,
      model: requestedModel,
      reason: 'User requested this provider and model for the current thread.',
    })
  }

  if (taskPreference) {
    candidates.push({
      provider: taskPreference.providerId,
      model: taskPreference.model,
      reason: 'User settings define a task-specific provider preference.',
    })
  }

  if (options.taskClass === 'research') {
    candidates.push({
      provider: options.env.DEFAULT_RESEARCH_PROVIDER,
      model: options.env.DEFAULT_RESEARCH_MODEL,
      reason: 'Research routing uses the configured research default.',
    })
  } else if (options.taskClass === 'vision') {
    candidates.push({
      provider: options.env.DEFAULT_VISION_PROVIDER,
      model: options.env.DEFAULT_VISION_MODEL,
      reason: 'Vision routing uses the configured vision default.',
    })
  } else {
    candidates.push({
      provider: options.env.DEFAULT_CHAT_PROVIDER,
      model: options.env.DEFAULT_CHAT_MODEL,
      reason: 'Chat routing uses the configured chat default.',
    })
  }

  for (const provider of providers) {
    candidates.push({
      provider,
      model:
        provider === 'anthropic'
          ? 'claude-sonnet-4-5'
          : provider === 'gemini'
            ? 'gemini-2.5-flash'
            : provider === 'openrouter'
              ? 'openai/gpt-4.1-mini'
              : 'gpt-4.1-mini',
      reason:
        'Provider fallback selected the next available configured provider.',
    })
  }

  const selected = candidates.find((candidate) =>
    providers.includes(candidate.provider),
  )

  if (!selected) {
    throw new Error('Unable to resolve an AI provider route.')
  }

  return routeDecisionSchema.parse({
    taskClass: options.taskClass,
    provider: selected.provider,
    model: selected.model,
    reason: selected.reason,
    usedByok: Boolean(options.keyMap[selected.provider]?.useByok),
    availableProviders: providers,
  })
}
