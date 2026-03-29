import type { RainCheckEnv } from '@raincheck/config'
import {
  type AppSettings,
  type ProviderId,
  routeDecisionSchema,
} from '@raincheck/contracts'

export type ProviderRouteState = {
  available: boolean
  defaultModel: string
  transport: 'api'
  source: 'shared-env' | 'local-api-key'
}

function configuredFallbackModel(provider: ProviderId) {
  switch (provider) {
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

function getAvailableProviders(
  providerStates: Partial<Record<ProviderId, ProviderRouteState>>,
) {
  return (
    Object.entries(providerStates) as Array<
      [ProviderId, ProviderRouteState | undefined]
    >
  )
    .filter(([, state]) => state?.available)
    .map(([provider]) => provider)
}

function fallbackModelForProvider(
  provider: ProviderId,
  providerStates: Partial<Record<ProviderId, ProviderRouteState>>,
) {
  return (
    providerStates[provider]?.defaultModel ?? configuredFallbackModel(provider)
  )
}

function normalizeDefaultCandidate(input: {
  provider: ProviderId
  model: string
  providerStates: Partial<Record<ProviderId, ProviderRouteState>>
}) {
  return input.model
}

export function chooseRoute(options: {
  env: RainCheckEnv
  taskClass: 'chat' | 'research' | 'vision'
  settings?: AppSettings
  providerStates: Partial<Record<ProviderId, ProviderRouteState>>
  requestedProvider?: ProviderId
  requestedModel?: string
}) {
  const providers = getAvailableProviders(options.providerStates)
  if (providers.length === 0) {
    throw new Error(
      'No AI provider connection is available. Configure a shared or saved API key to continue.',
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
      model: normalizeDefaultCandidate({
        provider: options.env.DEFAULT_RESEARCH_PROVIDER,
        model: options.env.DEFAULT_RESEARCH_MODEL,
        providerStates: options.providerStates,
      }),
      reason: 'Research routing uses the configured research default.',
    })
  } else if (options.taskClass === 'vision') {
    candidates.push({
      provider: options.env.DEFAULT_VISION_PROVIDER,
      model: normalizeDefaultCandidate({
        provider: options.env.DEFAULT_VISION_PROVIDER,
        model: options.env.DEFAULT_VISION_MODEL,
        providerStates: options.providerStates,
      }),
      reason: 'Vision routing uses the configured vision default.',
    })
  } else {
    candidates.push({
      provider: options.env.DEFAULT_CHAT_PROVIDER,
      model: normalizeDefaultCandidate({
        provider: options.env.DEFAULT_CHAT_PROVIDER,
        model: options.env.DEFAULT_CHAT_MODEL,
        providerStates: options.providerStates,
      }),
      reason: 'Chat routing uses the configured chat default.',
    })
  }

  for (const provider of providers) {
    candidates.push({
      provider,
      model: fallbackModelForProvider(provider, options.providerStates),
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

  const selectedState = options.providerStates[selected.provider]
  if (!selectedState) {
    throw new Error('Unable to resolve provider route state.')
  }

  return routeDecisionSchema.parse({
    taskClass: options.taskClass,
    provider: selected.provider,
    model: selected.model,
    reason: selected.reason,
    transport: selectedState.transport,
    source: selectedState.source,
    availableProviders: providers,
  })
}
