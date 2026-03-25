import type { Conversation, ProviderId } from '@raincheck/contracts'
import type { UIMessage } from '@tanstack/ai'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { apiClient, resolveApiUrl, type SettingsPayload } from '../lib/api'
import { useRainCheckChat } from '../lib/chat'
import {
  type ChatLocationOverride,
  loadStoredLocationPreference,
  type StoredLocationPreference,
  saveStoredLocationPreference,
} from '../lib/location'
import { mapRecordsToUiMessages } from '../lib/messages'
import {
  findModelOptionByRoute,
  getAvailableModelOptions,
} from '../lib/model-options'
import { applyTheme, loadTheme } from '../lib/theme'
import { ArtifactViewer } from './artifact-viewer'
import { Composer, type ReasoningLevel } from './composer'
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
  locationOverride?: ChatLocationOverride | null
}

type LiveStatus = {
  id: number
  label: string
}

const defaultRouteSelection: RouteSelection = {
  provider: 'openai',
  model: 'gpt-4.1-mini',
}

const progressLabelMap: Record<string, string> = {
  'Resolving location': 'Pinning down the area',
  'Fetching current conditions': 'Checking current observations',
  'Fetching forecast': 'Checking the official forecast',
  'Fetching alerts': 'Checking active alerts',
  'Fetching severe context': 'Checking SPC severe setup',
  'Fetching short-range guidance': 'Comparing short-range guidance',
  'Fetching radar, satellite, and nowcast context':
    'Checking radar, satellite, and nowcast',
  'Fetching precipitation and flood context': 'Checking flood guidance',
  'Fetching global guidance': 'Comparing global guidance',
  'Fetching aviation context': 'Checking aviation weather',
  'Fetching fire-weather outlooks': 'Checking fire-weather guidance',
  'Fetching winter weather guidance': 'Checking winter guidance',
  'Fetching medium-range hazards': 'Checking medium-range hazards',
  'Fetching tropical outlooks': 'Checking tropical guidance',
  'Fetching marine guidance': 'Checking marine guidance',
  'Fetching upper-air soundings': 'Checking upper-air data',
  'Fetching historical climate data': 'Checking climate history',
  'Fetching storm history': 'Checking storm history',
  'Synthesizing weather conclusion': 'Writing the answer',
}

function formatProgressLabel(label: string) {
  return progressLabelMap[label] ?? label
}

export function ChatShell({ conversationId }: ChatShellProps) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [isHydrated, setIsHydrated] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [composerValue, setComposerValue] = useState('')
  const [selectedRoute, setSelectedRoute] = useState<RouteSelection>(
    defaultRouteSelection,
  )
  const [pendingDraft, setPendingDraft] = useState<PendingDraft | null>(null)
  const [liveStatus, setLiveStatus] = useState<LiveStatus | null>(null)
  const [selectedArtifact, setSelectedArtifact] = useState<{
    href: string
    title: string
    mimeType: string
    imageAlt?: string
  } | null>(null)
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel>('none')
  const [locationPreference, setLocationPreference] =
    useState<StoredLocationPreference | null>(() =>
      loadStoredLocationPreference(),
    )

  const draftSentRef = useRef(false)
  const hydratedRouteConversationIdRef = useRef<string | null>(null)
  const syncedConversationSnapshotRef = useRef<string | null>(null)
  const messageEndRef = useRef<HTMLDivElement | null>(null)
  const liveStatusIdRef = useRef(0)

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

  const deleteConversationMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteConversation(id),
  })

  const updateConversationMutation = useMutation({
    mutationFn: (vars: {
      id: string
      updates: { title?: string; pinned?: boolean }
    }) => apiClient.updateConversation(vars.id, vars.updates),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })
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
    [availableModelOptions, selectedRoute],
  )

  /* ── Build user message history (most recent first) ── */

  const userMessageHistory = useMemo(() => {
    const messages = conversationId
      ? (conversationQuery.data?.messages ?? [])
      : []
    return messages
      .filter((m) => m.role === 'user')
      .map((m) => {
        const parts = m.parts ?? []
        return parts
          .filter((p: any) => p.type === 'text')
          .map((p: any) => p.content ?? p.text ?? '')
          .join('')
      })
      .filter(Boolean)
      .reverse()
  }, [conversationId, conversationQuery.data?.messages])

  const effectiveLocationOverride = useMemo<ChatLocationOverride | null>(() => {
    if (locationPreference?.mode === 'custom') {
      return locationPreference.value
    }

    if (locationPreference?.mode === 'cleared') {
      return null
    }

    const defaultLocationLabel =
      settingsQuery.data?.defaultLocationLabel?.trim()
    return defaultLocationLabel
      ? {
          label: defaultLocationLabel,
        }
      : null
  }, [locationPreference, settingsQuery.data?.defaultLocationLabel])

  const handleLocationChange = useCallback(
    (next: ChatLocationOverride | null) => {
      if (!next) {
        setLocationPreference({
          mode: 'cleared',
        })
        return
      }

      setLocationPreference({
        mode: 'custom',
        value: next,
      })
    },
    [],
  )

  useEffect(() => {
    saveStoredLocationPreference(locationPreference)
  }, [locationPreference])

  const chat = useRainCheckChat({
    conversationId: conversationId ?? 'draft',
    initialMessages,
    provider: selectedRoute.provider,
    model: selectedRoute.model,
    locationOverride: effectiveLocationOverride ?? undefined,
    onCustomEvent: (eventType: string, data: unknown) => {
      if (eventType === 'tool-progress') {
        const label = formatProgressLabel(
          String((data as any)?.label ?? 'Working'),
        )
        setLiveStatus((current) =>
          current?.label === label
            ? current
            : {
                id: ++liveStatusIdRef.current,
                label,
              },
        )
      }
    },
    onError: () => {
      setLiveStatus(null)
    },
    onFinish: async () => {
      setLiveStatus(null)
      setComposerValue('')

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
  }, [availableModelOptions, selectedRoute])

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
      locationOverride: parsed.locationOverride ?? null,
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
    void chat.sendMessage(
      pendingDraft.text,
      pendingDraft.locationOverride
        ? {
            locationOverride: pendingDraft.locationOverride,
          }
        : undefined,
    )
  }, [
    chat,
    conversationId,
    pendingDraft,
    selectedRoute.model,
    selectedRoute.provider,
  ])

  const messages = conversationId ? chat.messages : []
  const showPendingAssistantRow =
    chat.isLoading && messages[messages.length - 1]?.role !== 'assistant'

  useEffect(() => {
    messageEndRef.current?.scrollIntoView({
      behavior: chat.isLoading ? 'auto' : 'smooth',
    })
  }, [chat.isLoading, messages])

  async function resolveMessageLocationOverride() {
    if (effectiveLocationOverride) {
      return effectiveLocationOverride
    }

    if (locationPreference == null && !settingsQuery.isFetched) {
      const settings = await queryClient.ensureQueryData({
        queryKey: ['settings'],
        queryFn: () => apiClient.getSettings(),
      })

      const defaultLocationLabel = settings.defaultLocationLabel?.trim()
      if (defaultLocationLabel) {
        return {
          label: defaultLocationLabel,
        } satisfies ChatLocationOverride
      }
    }

    return null
  }

  async function createAndNavigateWithDraft(text?: string) {
    const conversation = await apiClient.createConversation()
    await queryClient.invalidateQueries({ queryKey: ['conversations'] })
    if (text) {
      const locationOverride = await resolveMessageLocationOverride()
      window.sessionStorage.setItem(
        pendingDraftKey(),
        JSON.stringify({
          conversationId: conversation.id,
          text,
          provider: selectedRoute.provider,
          model: selectedRoute.model,
          locationOverride,
        }),
      )
    }
    navigate({
      params: { id: conversation.id },
      to: '/chat/$id',
    })
  }

  async function handleDeleteConversation(conversation: Conversation) {
    const confirmed = window.confirm(
      `Delete "${conversation.title}"? This cannot be undone.`,
    )
    if (!confirmed) {
      return
    }

    try {
      await deleteConversationMutation.mutateAsync(conversation.id)
      queryClient.removeQueries({
        queryKey: ['conversation', conversation.id],
      })
      await queryClient.invalidateQueries({ queryKey: ['conversations'] })

      if (conversationId === conversation.id) {
        hydratedRouteConversationIdRef.current = null
        syncedConversationSnapshotRef.current = null
        draftSentRef.current = false
        setLiveStatus(null)
        setSelectedArtifact(null)
        navigate({ to: '/' })
      }
    } catch {
      window.alert('Could not delete that conversation. Please try again.')
    }
  }

  async function submitComposer() {
    const trimmed = composerValue.trim()
    if (!trimmed) {
      return
    }

    // Instantly clear input (optimistic)
    setComposerValue('')
    setLiveStatus(null)

    if (!conversationId) {
      await createAndNavigateWithDraft(trimmed)
      return
    }

    const messageLocationOverride = await resolveMessageLocationOverride()

    await chat.sendMessage(
      trimmed,
      messageLocationOverride
        ? {
            locationOverride: messageLocationOverride,
          }
        : undefined,
    )
  }

  async function handleEditAndResend(messageId: string, newText: string) {
    if (!conversationId || !newText) return

    // Find the message index, truncate messages back to that point, and resend
    const messageIndex = chat.messages.findIndex((m: any) => m.id === messageId)
    if (messageIndex < 0) return

    // Keep messages up to (not including) the edited message
    const truncated = chat.messages.slice(0, messageIndex)
    chat.setMessages(truncated)

    // Send the new text
    await chat.sendMessage(newText)
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
          onDeleteConversation={(conversation) =>
            void handleDeleteConversation(conversation)
          }
          onRenameConversation={(conversation, title) =>
            void updateConversationMutation.mutateAsync({
              id: conversation.id,
              updates: { title },
            })
          }
          onTogglePin={(conversation) =>
            void updateConversationMutation.mutateAsync({
              id: conversation.id,
              updates: { pinned: !conversation.pinned },
            })
          }
          onOpenSettings={() => setSettingsOpen(true)}
          onToggle={() => setSidebarCollapsed((current) => !current)}
          deletingConversationId={
            deleteConversationMutation.isPending
              ? (deleteConversationMutation.variables ?? null)
              : null
          }
        />

        <main className="thread-shell">
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
                  isStreaming={
                    chat.isLoading &&
                    message.role === 'assistant' &&
                    index === messages.length - 1
                  }
                  key={message.id}
                  message={message}
                  suppressThinkingIndicator={Boolean(
                    liveStatus &&
                      chat.isLoading &&
                      message.role === 'assistant' &&
                      index === messages.length - 1,
                  )}
                  onCopy={(text) => navigator.clipboard.writeText(text)}
                  onEditAndResend={(messageId, newText) =>
                    void handleEditAndResend(messageId, newText)
                  }
                  onOpenArtifact={setSelectedArtifact}
                  onRetry={() => void chat.reload()}
                />
              ))
            )}
            {showPendingAssistantRow || liveStatus ? (
              <div className="message-row">
                <div className="message-wrap">
                  <div className="message-bubble">
                    <div
                      aria-live="polite"
                      className="assistant-status"
                      key={liveStatus?.id ?? 'pending'}
                      role="status"
                    >
                      <div className="thinking-indicator">
                        <span className="thinking-dot" />
                        <span className="thinking-dot" />
                        <span className="thinking-dot" />
                      </div>
                      {liveStatus ? (
                        <span className="assistant-status-label">
                          {liveStatus.label}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            {chat.error ? (
              <div className="message-row">
                <div className="message-wrap">
                  <div className="message-bubble">
                    <div
                      aria-live="polite"
                      className="assistant-status is-error"
                      role="status"
                    >
                      <span className="assistant-status-label">
                        Request failed. Try again.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
            <div ref={messageEndRef} />
          </section>

          <Composer
            isLoading={chat.isLoading}
            locationLabel={effectiveLocationOverride?.label ?? null}
            messageHistory={userMessageHistory}
            modelOptions={availableModelOptions}
            onChange={setComposerValue}
            onLocationChange={handleLocationChange}
            onModelChange={(option) =>
              setSelectedRoute({
                provider: option.provider,
                model: option.model,
              })
            }
            onReasoningLevelChange={setReasoningLevel}
            onSubmit={() => void submitComposer()}
            reasoningLevel={reasoningLevel}
            selectedModel={selectedModelOption}
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
