import type {
  DesktopLocalCliConnectionState,
  DesktopLocalCliProviderId,
  ProviderConnectionState,
  ProviderId,
  ProviderSource,
  ProviderTransport,
} from '@raincheck/contracts'

export type ModelOption = {
  id: string
  label: string
  description: string
  provider: ProviderId
  providerLabel: string
  model: string
  transport: ProviderTransport
  source: ProviderSource
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

const apiModelOptionsByProvider: Record<
  ProviderId,
  Array<Omit<ModelOption, 'provider' | 'providerLabel'>>
> = {
  openai: [
    {
      id: 'gpt-4.1-mini',
      label: 'GPT-4.1 Mini',
      description: 'Fast everyday weather chat.',
      model: 'gpt-4.1-mini',
      transport: 'api',
      source: 'shared-env',
    },
    {
      id: 'gpt-4.1',
      label: 'GPT-4.1',
      description: 'Stronger reasoning for deeper weather analysis.',
      model: 'gpt-4.1',
      transport: 'api',
      source: 'shared-env',
    },
  ],
  anthropic: [
    {
      id: 'claude-sonnet-4-5',
      label: 'Claude Sonnet 4.5',
      description: 'Balanced writing and tool use for longer answers.',
      model: 'claude-sonnet-4-5',
      transport: 'api',
      source: 'shared-env',
    },
  ],
  gemini: [
    {
      id: 'gemini-3.1-pro-preview',
      label: 'Gemini 3.1 Pro',
      description:
        'Frontier reasoning and coding for the hardest chat requests.',
      model: 'gemini-3.1-pro-preview',
      transport: 'api',
      source: 'shared-env',
    },
    {
      id: 'gemini-3.1-flash-lite-preview',
      label: 'Gemini 3.1 Flash-Lite',
      description:
        'High-throughput Gemini 3 chat at the lowest latency and cost.',
      model: 'gemini-3.1-flash-lite-preview',
      transport: 'api',
      source: 'shared-env',
    },
    {
      id: 'gemini-3-flash-preview',
      label: 'Gemini 3 Flash',
      description:
        'Fast Gemini 3 responses with strong search and grounding support.',
      model: 'gemini-3-flash-preview',
      transport: 'api',
      source: 'shared-env',
    },
    {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      description: 'Quick responses with strong multimodal support.',
      model: 'gemini-2.5-flash',
      transport: 'api',
      source: 'shared-env',
    },
    {
      id: 'gemini-2.5-pro',
      label: 'Gemini 2.5 Pro',
      description: 'Deeper reasoning and coding for harder requests.',
      model: 'gemini-2.5-pro',
      transport: 'api',
      source: 'shared-env',
    },
    {
      id: 'gemini-2.5-flash-lite',
      label: 'Gemini 2.5 Flash-Lite',
      description: 'Lowest-latency Gemini option for fast, lightweight chats.',
      model: 'gemini-2.5-flash-lite',
      transport: 'api',
      source: 'shared-env',
    },
  ],
  openrouter: [
    {
      id: 'gpt-4.1-mini-openrouter',
      label: 'GPT-4.1 Mini',
      description: 'Fast everyday weather chat through OpenRouter.',
      model: 'openai/gpt-4.1-mini',
      transport: 'api',
      source: 'shared-env',
    },
  ],
}

const localCliModelOptionsByProvider: Record<
  DesktopLocalCliProviderId,
  Array<Pick<ModelOption, 'label' | 'description' | 'model'>>
> = {
  openai: [
    {
      label: 'GPT-5.4',
      description: 'Codex flagship model.',
      model: 'gpt-5.4',
    },
    {
      label: 'GPT-5.4 Mini',
      description: 'Faster Codex option for everyday chat.',
      model: 'gpt-5.4-mini',
    },
    {
      label: 'GPT-5.3 Codex',
      description: 'Stable Codex-native GPT-5.3 model.',
      model: 'gpt-5.3-codex',
    },
    {
      label: 'GPT-5.3 Codex Spark',
      description: 'Fast Codex-native GPT-5.3 variant.',
      model: 'gpt-5.3-codex-spark',
    },
    {
      label: 'GPT-5.2 Codex',
      description: 'Older Codex model for compatibility.',
      model: 'gpt-5.2-codex',
    },
    {
      label: 'GPT-5.2',
      description: 'Older general GPT-5 model.',
      model: 'gpt-5.2',
    },
  ],
  anthropic: [
    {
      label: 'Claude Opus 4.6',
      description: 'Claude flagship model.',
      model: 'claude-opus-4-6',
    },
    {
      label: 'Claude Sonnet 4.6',
      description: 'Balanced Claude model for most chats.',
      model: 'claude-sonnet-4-6',
    },
    {
      label: 'Claude Haiku 4.5',
      description: 'Fast Claude model for lighter requests.',
      model: 'claude-haiku-4-5',
    },
  ],
}

function buildLocalCliOptions(
  connection: DesktopLocalCliConnectionState | null,
): Array<ModelOption> {
  if (!connection?.localCli.authReady) {
    return []
  }

  const providerLabel = providerLabels[connection.providerId]
  const providerSourceLabel =
    connection.providerId === 'openai' ? 'Codex' : 'Claude Code'

  return localCliModelOptionsByProvider[connection.providerId].map(
    (option) => ({
      id: `local-cli:${connection.providerId}:${option.model}`,
      label: option.label,
      description: option.description,
      provider: connection.providerId,
      providerLabel: `${providerLabel} via ${providerSourceLabel}`,
      model: option.model,
      transport: 'local-cli',
      source: 'desktop-local-cli',
    }),
  )
}

export function getAvailableModelOptions(input?: {
  availableProviders?: Array<ProviderId>
  providerConnections?: Array<ProviderConnectionState>
  desktopProviderConnections?: Array<DesktopLocalCliConnectionState>
}): Array<ModelOption> {
  const activeProviders = input?.availableProviders ?? providerOrder
  const apiConnectionMap = new Map(
    (input?.providerConnections ?? [])
      .filter((connection) => connection.available)
      .map((connection) => [connection.providerId, connection]),
  )
  const desktopConnectionMap = new Map(
    (input?.desktopProviderConnections ?? []).map((connection) => [
      connection.providerId,
      connection,
    ]),
  )

  return providerOrder.flatMap((provider) => {
    const options =
      provider === 'openai' || provider === 'anthropic'
        ? buildLocalCliOptions(desktopConnectionMap.get(provider) ?? null)
        : []

    if (
      !activeProviders.includes(provider) ||
      !apiConnectionMap.has(provider)
    ) {
      return options
    }

    return [
      ...options,
      ...apiModelOptionsByProvider[provider].map((option) => {
        const source: ProviderSource =
          apiConnectionMap.get(provider)?.mode === 'api-key'
            ? 'local-api-key'
            : 'shared-env'

        return {
          ...option,
          provider,
          providerLabel: providerLabels[provider],
          source,
        }
      }),
    ]
  })
}

export function findModelOptionByRoute(
  options: Array<ModelOption>,
  route?: {
    provider?: ProviderId | null
    model?: string | null
    transport?: ProviderTransport | null
    source?: ProviderSource | null
  } | null,
) {
  if (!route?.provider || !route.model) {
    return null
  }

  return (
    options.find(
      (option) =>
        option.provider === route.provider &&
        option.model === route.model &&
        (route.transport == null || option.transport === route.transport) &&
        (route.source == null || option.source === route.source),
    ) ?? null
  )
}
