import type {
  AppSettings,
  Conversation,
  CreateConversationInput,
  MessageRecord,
  ProviderId,
  UpdateSettingsInput,
} from '@raincheck/contracts'

type ApiClientOptions = {
  baseUrl: string
  fetcher?: typeof fetch
}

type SettingsPayload = AppSettings & {
  availableProviders?: Array<ProviderId>
}

function defaultFetcher(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) {
  return globalThis.fetch(input, init)
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }

  return response.json() as Promise<T>
}

function assertOk(response: Response) {
  if (!response.ok) {
    throw new Error(`Request failed with ${response.status}`)
  }
}

export class RainCheckClient {
  private readonly baseUrl: string
  private readonly fetcher: typeof fetch

  constructor(options: ApiClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.fetcher = options.fetcher ?? defaultFetcher
  }

  async listConversations(): Promise<Array<Conversation>> {
    const response = await this.fetcher(`${this.baseUrl}/api/conversations`)
    const data = await readJson<{ conversations: Array<Conversation> }>(
      response,
    )
    return data.conversations
  }

  async createConversation(
    input: CreateConversationInput = {},
  ): Promise<Conversation> {
    const response = await this.fetcher(`${this.baseUrl}/api/conversations`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })

    const data = await readJson<{ conversation: Conversation }>(response)
    return data.conversation
  }

  async getConversation(id: string): Promise<{
    conversation: Conversation
    messages: Array<MessageRecord>
  }> {
    const response = await this.fetcher(
      `${this.baseUrl}/api/conversations/${id}`,
    )
    return readJson(response)
  }

  async updateConversation(
    id: string,
    updates: { title?: string; pinned?: boolean },
  ): Promise<void> {
    const response = await this.fetcher(
      `${this.baseUrl}/api/conversations/${id}`,
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(updates),
      },
    )

    assertOk(response)
  }

  async deleteConversation(id: string): Promise<void> {
    const response = await this.fetcher(
      `${this.baseUrl}/api/conversations/${id}`,
      {
        method: 'DELETE',
      },
    )

    assertOk(response)
  }

  async getSettings(): Promise<SettingsPayload> {
    const response = await this.fetcher(`${this.baseUrl}/api/settings`)
    const data = await readJson<{
      settings: SettingsPayload
    }>(response)
    return data.settings
  }

  async updateSettings(input: UpdateSettingsInput): Promise<SettingsPayload> {
    const response = await this.fetcher(`${this.baseUrl}/api/settings`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })

    const data = await readJson<{
      settings: SettingsPayload
    }>(response)
    return data.settings
  }
}
