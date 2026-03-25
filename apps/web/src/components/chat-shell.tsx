import type { Conversation, ProviderId } from '@raincheck/contracts'
import type { UIMessage } from '@tanstack/ai'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { MapPin, Settings2 } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { apiClient, resolveApiUrl, type SettingsPayload } from '../lib/api'
import { useRainCheckChat } from '../lib/chat'
import {
  findModelOptionByRoute,
  getAvailableModelOptions,
} from '../lib/model-options'
import { mapRecordsToUiMessages } from '../lib/messages'
import { applyTheme, loadTheme } from '../lib/theme'
import { ArtifactViewer } from './artifact-viewer'
import { Composer } from './composer'
import { ConversationSidebar } from './conversation-sidebar'
import { MessageView } from './message-view'
import { SettingsPanel } from './settings-panel'

type ChatShellProps = {
  conversationId?: string
}

function pendingDraftKey() {
  return 'raincheck:pending-draft'
}

type RouteSelection = {
  provider: ProviderId
  model: string
}

type PendingDraft = RouteSelection & {
  conversationId: string
  text: string
}

const defaultRouteSelection: RouteSelection = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
}

export function ChatShell({ conversationId }: ChatShellProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isHydrated, setIsHydrated] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [composerValue, setComposerValue] = useState('')
  const [editingLabel, setEditingLabel] = useState<string | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<RouteSelection>(
    defaultRouteSelection,
  )
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null)
  const [progressLabels, setProgressLabels] = useState<Array<string>>([])
  const [selectedArtifact, setSelectedArtifact] = useState<{
    href: string
    title: string
    mimeType: string
    imageAlt?: string
  } | null>(null)
  const draftSentRef = useRef(false)
  const hydratedRouteConversationIdRef = useRef<string | null>(null)
  const syncedConversationSnapshotRef = useRef<string | null>(null)
  const messageEndRef = useRef<HTMLDivElement | null>(null)

  const conversationsQuery = useQuery({
    queryKey: ['conversations'],
    queryFn: () => apiClient.listConversations(),
  })

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => apiClient.getSettings(),
  })

  const conversationQuery = useQuery({
    enabled: Boolean(conversationId),
    queryKey: ['conversation', conversationId],
    queryFn: () => apiClient.getConversation(conversationId ?? ''),
  })

  const settingsMutation = useMutation({
    mutationFn: (next: SettingsPayload) =>
      apiClient.updateSettings(next as any),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  const initialMessages = useMemo<Array<UIMessage>>(
    () =>
      conversationQuery.data
        ? mapRecordsToUiMessages(conversationQuery.data.messages)
        : [],
    [conversationQuery.data],
  )

  const availableModelOptions = useMemo(
    () => getAvailableModelOptions(settingsQuery.data?.availableProviders),
    [settingsQuery.data?.availableProviders],
  )

  const selectedModelOption = useMemo(
    () =>
      findModelOptionByRoute(availableModelOptions, selectedRoute) ??
      availableModelOptions[0] ??
      null,
    [availableModelOptions, selectedRoute.model, selectedRoute.provider],
  )

  const modelPickerPlaceholder = settingsQuery.isLoading
    ? 'Loading...'
    : 'No provider'

  const chat = useRainCheckChat({
    conversationId: conversationId ?? 'draft',
    initialMessages,
    provider: selectedRoute.provider,
    model: selectedRoute.model,
    onCustomEvent: (eventType: string, data: unknown) => {
      if (eventType === 'tool-progress') {
        setProgressLabels((current) => [
          ...current,
          String((data as any)?.label ?? 'Working'),
        ])
      }
    },
    onFinish: async () => {
      setProgressLabels([])
      setComposerValue('')
      setEditingLabel(null)
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
      if (conversationId) {
        await queryClient.invalidateQueries({
          queryKey: ['conversation', conversationId],
        })
      }
    },
  })

  useEffect(() => {
    if (!conversationId) {
      hydratedRouteConversationIdRef.current = null
      syncedConversationSnapshotRef.current = null
      draftSentRef.current = false
      if (pendingDraft) {
        setPendingDraft(null)
      }
    }
  }, [conversationId, pendingDraft])

  useEffect(() => {
    if (!conversationId || !conversationQuery.data || chat.isLoading) {
      return
    }

    const snapshot = conversationQuery.data.messages
      .map((message) => `${message.id}:${message.createdAt}`)
      .join('|')

    if (syncedConversationSnapshotRef.current === snapshot) {
      return
    }

    syncedConversationSnapshotRef.current = snapshot
    chat.setMessages(initialMessages)
  }, [
    chat,
    conversationId,
    conversationQuery.data,
    initialMessages,
    chat.isLoading,
  ])

  useEffect(() => {
    if (availableModelOptions.length === 0) {
      return
    }

    const matchingOption = findModelOptionByRoute(
      availableModelOptions,
      selectedRoute,
    )
    if (matchingOption) {
      return
    }

    const fallbackOption = availableModelOptions[0]
    setSelectedRoute({
      provider: fallbackOption.provider,
      model: fallbackOption.model,
    })
  }, [availableModelOptions, selectedRoute.model, selectedRoute.provider])

  useEffect(() => {
    const mode = loadTheme()
    applyTheme(mode)
  }, [])

  useEffect(() => {
    setIsHydrated(true)
  }, [])

  useEffect(() => {
    function handleOpenArtifact(event: Event) {
      const detail = (event as CustomEvent).detail as { artifactId?: string }
      if (!detail?.artifactId) {
        return
      }

      const artifact = conversationQuery.data?.messages
        .flatMap((message) => message.artifacts)
        .find((item) => item.id === detail.artifactId)

      if (artifact) {
        setSelectedArtifact({
          href: artifact.href,
          title: artifact.title,
          mimeType: artifact.mimeType,
        })
      }
    }

    window.addEventListener('raincheck:open-artifact', handleOpenArtifact)
    return () =>
      window.removeEventListener('raincheck:open-artifact', handleOpenArtifact)
  }, [conversationQuery.data])

  useEffect(() => {
    if (
      !conversationId ||
      !conversationQuery.data ||
      hydratedRouteConversationIdRef.current === conversationId
    ) {
      return
    }

    const latestRoutedMessage = [...conversationQuery.data.messages]
      .reverse()
      .find((message) => message.provider && message.model)
    if (latestRoutedMessage && availableModelOptions.length === 0) {
      return
    }

    const matchingOption = findModelOptionByRoute(
      availableModelOptions,
      latestRoutedMessage,
    )

    if (matchingOption) {
      setSelectedRoute({
        provider: matchingOption.provider,
        model: matchingOption.model,
      })
    }

    hydratedRouteConversationIdRef.current = conversationId
  }, [availableModelOptions, conversationId, conversationQuery.data])

  useEffect(() => {
    if (!conversationId || draftSentRef.current) {
      return
    }

    const serializedDraft = window.sessionStorage.getItem(pendingDraftKey())
    if (!serializedDraft) {
      return
    }

    const parsed = JSON.parse(serializedDraft) as Partial<PendingDraft>
    if (parsed.conversationId !== conversationId || !parsed.text) {
      return
    }

    const nextDraft: PendingDraft = {
      conversationId,
      text: parsed.text,
      provider: parsed.provider ?? selectedRoute.provider,
      model: parsed.model ?? selectedRoute.model,
    }

    if (
      nextDraft.provider !== selectedRoute.provider ||
      nextDraft.model !== selectedRoute.model
    ) {
      setSelectedRoute({
        provider: nextDraft.provider,
        model: nextDraft.model,
      })
    }

    if (pendingDraft?.conversationId === nextDraft.conversationId) {
      return
    }

    draftSentRef.current = true
    window.sessionStorage.removeItem(pendingDraftKey())
    setPendingDraft(nextDraft)
  }, [
    conversationId,
    pendingDraft,
    selectedRoute.model,
    selectedRoute.provider,
  ])

  useEffect(() => {
    if (!pendingDraft || pendingDraft.conversationId !== conversationId) {
      return
    }

    if (
      pendingDraft.provider !== selectedRoute.provider ||
      pendingDraft.model !== selectedRoute.model
    ) {
      return
    }

    setPendingDraft(null)
    void chat.sendMessage(pendingDraft.text)
  }, [
    chat,
    conversationId,
    pendingDraft,
    selectedRoute.model,
    selectedRoute.provider,
  ])

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  })

  const messages = conversationId ? chat.messages : []
  const currentConversation = conversationsQuery.data?.find(
    (conversation) => conversation.id === conversationId,
  )

  async function createAndNavigateWithDraft(text?: string) {
    const conversation = await apiClient.createConversation()
    await queryClient.invalidateQueries({ queryKey: ['conversations'] })
    if (text) {
      window.sessionStorage.setItem(
        pendingDraftKey(),
        JSON.stringify({
          conversationId: conversation.id,
          text,
          provider: selectedRoute.provider,
          model: selectedRoute.model,
        }),
      )
    }
    navigate({
      params: { id: conversation.id },
      to: '/chat/$id',
    })
  }

  async function submitComposer() {
    const trimmed = composerValue.trim()
    if (!trimmed) {
      return
    }

    if (!conversationId) {
      await createAndNavigateWithDraft(trimmed)
      return
    }

    await chat.sendMessage(trimmed)
  }

  async function storeByok(providerId: string, apiKey: string) {
    if (!apiKey.trim()) {
      return
    }

    await fetch(resolveApiUrl('/api/settings/byok'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ providerId, apiKey }),
    })
    await queryClient.invalidateQueries({ queryKey: ['settings'] })
  }

  async function clearByok(providerId: string) {
    await fetch(resolveApiUrl(`/api/settings/byok/${providerId}`), {
      method: 'DELETE',
    })
    await queryClient.invalidateQueries({ queryKey: ['settings'] })
  }

  return (
    <>
      <div className="app-shell" data-hydrated={isHydrated ? 'true' : 'false'}>
        <ConversationSidebar
          collapsed={sidebarCollapsed}
          conversations={conversationsQuery.data ?? ([] as Array<Conversation>)}
          onCreateConversation={() => void createAndNavigateWithDraft()}
          onOpenSettings={() => setSettingsOpen(true)}
          onToggle={() => setSidebarCollapsed((current) => !current)}
        />

        <main className="thread-shell">
          <header className="thread-header">
            <div className="thread-header-title">
              <h1>{currentConversation?.title ?? 'New thread'}</h1>
              {settingsQuery.data?.defaultLocationLabel ? (
                <p>
                  <MapPin size={12} />
                  {settingsQuery.data.defaultLocationLabel}
                </p>
              ) : null}
            </div>

            <div className="thread-controls">
              <select
                aria-label="Chat model"
                disabled={availableModelOptions.length === 0}
                value={selectedModelOption?.id ?? ''}
                onChange={(event) => {
                  const nextOption = availableModelOptions.find(
                    (option) => option.id === event.target.value,
                  )

                  if (!nextOption) {
                    return
                  }

                  setSelectedRoute({
                    provider: nextOption.provider,
                    model: nextOption.model,
                  })
                }}
              >
                {availableModelOptions.length === 0 ? (
                  <option value="">{modelPickerPlaceholder}</option>
                ) : (
                  availableModelOptions.map((option) => (
                    <option
                      key={`${option.provider}:${option.model}`}
                      value={option.id}
                    >
                      {option.label}
                    </option>
                  ))
                )}
              </select>
              <button
                aria-label="Open settings"
                className="ghost-icon-button"
                onClick={() => setSettingsOpen(true)}
                type="button"
              >
                <Settings2 size={16} />
              </button>
            </div>
          </header>

          <section className="thread-messages">
            {messages.length === 0 ? (
              <div className="empty-thread">
                <p className="sidebar-brand">RainCheck</p>
              </div>
            ) : (
              messages.map((message: any, index: number) => (
                <MessageView
                  isLastAssistant={
                    message.role === 'assistant' &&
                    messages
                      .slice(index + 1)
                      .every((item: any) => item.role !== 'assistant')
                  }
                  key={message.id}
                  message={message}
                  onCopy={(text) => navigator.clipboard.writeText(text)}
                  onEdit={(text) => {
                    setComposerValue(text)
                    setEditingLabel(text)
                  }}
                  onOpenArtifact={setSelectedArtifact}
                  onRetry={() => void chat.reload()}
                />
              ))
            )}
            {progressLabels.length > 0 ? (
              <div className="progress-rail">
                {progressLabels.slice(-3).map((label) => (
                  <span className="progress-pill" key={label}>
                    {label}
                  </span>
                ))}
              </div>
            ) : null}
            <div ref={messageEndRef} />
          </section>

          <Composer
            editingLabel={editingLabel}
            isLoading={chat.isLoading}
            onCancelEdit={() => {
              setComposerValue('')
              setEditingLabel(null)
            }}
            onChange={setComposerValue}
            onSubmit={() => void submitComposer()}
            value={composerValue}
          />
        </main>
      </div>

      <ArtifactViewer
        artifact={selectedArtifact}
        onClose={() => setSelectedArtifact(null)}
      />
      <SettingsPanel
        isOpen={settingsOpen}
        onClearByok={clearByok}
        onClose={() => setSettingsOpen(false)}
        onSave={async (next) => {
          const { availableProviders: _availableProviders, ...settingsInput } =
            next
          await settingsMutation.mutateAsync(settingsInput)
          if (next.theme) {
            window.localStorage.setItem('raincheck-theme', next.theme)
            applyTheme(next.theme)
          }
          setSettingsOpen(false)
        }}
        onStoreByok={storeByok}
        settings={settingsQuery.data ?? null}
      />
    </>
  )
}
