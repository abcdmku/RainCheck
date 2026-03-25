import type { ProviderId } from '@raincheck/contracts'

export type ModelOption = {
  id: string
  label: string
  description: string
  provider: ProviderId
  providerLabel: string
  model: string
}

const providerOrder: Array<ProviderId> = [
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
]

const providerLabels: Record<ProviderId, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  gemini: 'Gemini',
  openrouter: 'OpenRouter',
}

const modelOptionsByProvider: Record<
  ProviderId,
  Array<Omit<ModelOption, 'provider' | 'providerLabel'>>
> = {
  openai: [
    {
      id: 'gpt-4.1-mini',
      label: 'GPT-4.1 Mini',
      description: 'Fast everyday weather chat.',
      model: 'gpt-4.1-mini',
    },
    {
      id: 'gpt-4.1',
      label: 'GPT-4.1',
      description: 'Stronger reasoning for deeper weather analysis.',
      model: 'gpt-4.1',
    },
  ],
  anthropic: [
    {
      id: 'claude-sonnet-4-5',
      label: 'Claude Sonnet 4.5',
      description: 'Balanced writing and tool use for longer answers.',
      model: 'claude-sonnet-4-5',
    },
  ],
  gemini: [
    {
      id: 'gemini-3.1-pro-preview',
      label: 'Gemini 3.1 Pro',
      description: 'Frontier reasoning and coding for the hardest chat requests.',
      model: 'gemini-3.1-pro-preview',
    },
    {
      id: 'gemini-3.1-flash-lite-preview',
      label: 'Gemini 3.1 Flash-Lite',
      description: 'High-throughput Gemini 3 chat at the lowest latency and cost.',
      model: 'gemini-3.1-flash-lite-preview',
    },
    {
      id: 'gemini-3-flash-preview',
      label: 'Gemini 3 Flash',
      description: 'Fast Gemini 3 responses with strong search and grounding support.',
      model: 'gemini-3-flash-preview',
    },
    {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      description: 'Quick responses with strong multimodal support.',
      model: 'gemini-2.5-flash',
    },
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      description: 'Deeper reasoning and coding for harder requests.',
      model: 'gemini-2.5-pro',
    },
    {
      id: 'gemini-2.5-flash-lite',
      label: 'Gemini 2.5 Flash-Lite',
      description: 'Lowest-latency Gemini option for fast, lightweight chats.',
      model: 'gemini-2.5-flash-lite',
    },
  ],
  openrouter: [
    {
      id: 'gpt-4.1-mini-openrouter',
      label: 'GPT-4.1 Mini',
      description: 'Fast everyday weather chat through OpenRouter.',
      model: 'openai/gpt-4.1-mini',
    },
  ],
}

export function getAvailableModelOptions(
  availableProviders?: Array<ProviderId>,
): Array<ModelOption> {
  const activeProviders = availableProviders ?? providerOrder
  const seenLabels = new Set<string>()

  return providerOrder.flatMap((provider) => {
    if (!activeProviders.includes(provider)) {
      return []
    }

    return modelOptionsByProvider[provider]
      .filter((option) => {
        if (seenLabels.has(option.label)) {
          return false
        }

        seenLabels.add(option.label)
        return true
      })
      .map((option) => ({
        ...option,
        provider,
        providerLabel: providerLabels[provider],
      }))
  })
}

export function findModelOptionByRoute(
  options: Array<ModelOption>,
  route?: {
    provider?: ProviderId | null
    model?: string | null
  } | null,
) {
  if (!route?.provider || !route.model) {
    return null
  }

  return (
    options.find(
      (option) =>
        option.provider === route.provider && option.model === route.model,
    ) ?? null
  )
}
