import {
  type AnswerTone,
  copyTextToolDef,
  type MessageRecord,
  openArtifactToolDef,
  type ProviderId,
  type ProviderSource,
  type ProviderTransport,
  type RuntimeInfo,
  requestGeolocationPermissionToolDef,
  runtimeInfoSchema,
  saveUiPreferenceToolDef,
  type TimeDisplay,
  type UnitSystem,
} from '@raincheck/contracts'
import type { ModelMessage, UIMessage } from '@tanstack/ai'
import {
  ChatClient,
  type ChatClientState,
  type ConnectionStatus,
  clientTools,
  fetchServerSentEvents,
} from '@tanstack/ai-client'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { resolveClientApiUrl } from './api'
import { getDesktopApiBaseUrl, getDesktopBridge } from './desktop'
import type { ChatLocationOverride } from './location'
import { mapRecordsToUiMessages } from './messages'

function browserTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone
  } catch {
    return undefined
  }
}

const geolocationTool = requestGeolocationPermissionToolDef.client(async () => {
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject)
  })

  return {
    name: 'Current device location',
    label: 'Current device location',
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    timezone: browserTimeZone(),
  }
})

const openArtifactTool = openArtifactToolDef.client(({ artifactId }) => {
  window.dispatchEvent(
    new CustomEvent('raincheck:open-artifact', {
      detail: { artifactId },
    }),
  )

  return { opened: true }
})

const copyTool = copyTextToolDef.client(async ({ text }) => {
  await navigator.clipboard.writeText(text)
  return { copied: true }
})

const savePreferenceTool = saveUiPreferenceToolDef.client(({ settings }) => {
  window.localStorage.setItem(
    'raincheck-ui-preferences',
    JSON.stringify(settings),
  )
  return { saved: true }
})

type SendMessageOptions = {
  locationOverride?: ChatLocationOverride
  clientRequestId?: string
}

function extractUiMessageText(message: ModelMessage | UIMessage) {
  if ('content' in message && typeof message.content === 'string') {
    return message.content
  }

  const messageParts = (message as { parts?: Array<any> }).parts
  if (!Array.isArray(messageParts)) {
    return ''
  }

  return messageParts
    .map((part: any) =>
      part?.type === 'text' && typeof part.content === 'string'
        ? part.content
        : '',
    )
    .join('')
}

export function useRainCheckChat(options: {
  conversationId: string
  initialMessages: Array<UIMessage>
  provider?: ProviderId
  model?: string
  transport?: ProviderTransport
  source?: ProviderSource
  locationOverride?: ChatLocationOverride
  answerTone?: AnswerTone
  units?: UnitSystem
  timeDisplay?: TimeDisplay
  onCustomEvent?: (
    eventType: string,
    data: unknown,
    context?: { toolCallId?: string },
  ) => void
  onError?: (error: Error) => void
  onFinish?: () => void
}) {
  const hookId = useId()
  const clientId = options.conversationId || hookId
  const sentRequestIdsRef = useRef(new Set<string>())
  const [messages, setMessages] = useState<Array<UIMessage>>(
    options.initialMessages,
  )
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | undefined>(undefined)
  const [status, setStatus] = useState<ChatClientState>('ready')
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>('disconnected')
  const [sessionGenerating, setSessionGenerating] = useState(false)
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeInfo | null>(null)
  const messagesRef = useRef(options.initialMessages)
  const isFirstMountRef = useRef(true)
  const optionsRef = useRef(options)
  const localCliRunRef = useRef<{ cancelled: boolean } | null>(null)
  const apiTarget = useMemo(() => resolveClientApiUrl('/api/chat'), [])
  const localCliMode = options.transport === 'local-cli'

  optionsRef.current = options

  const tools = useMemo(
    () =>
      clientTools(
        geolocationTool,
        openArtifactTool,
        copyTool,
        savePreferenceTool,
      ),
    [],
  )

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  const handleCustomEvent = useCallback(
    (eventType: string, data: unknown, context: { toolCallId?: string }) => {
      if (eventType === 'runtime-info') {
        const parsed = runtimeInfoSchema.safeParse(data)
        if (parsed.success) {
          setRuntimeInfo(parsed.data)
        }
      }

      optionsRef.current.onCustomEvent?.(eventType, data, context)
    },
    [],
  )

  const client = useMemo(() => {
    if (localCliMode) {
      return null
    }

    const messagesToUse = isFirstMountRef.current
      ? options.initialMessages
      : messagesRef.current

    isFirstMountRef.current = false

    return new ChatClient({
      connection: fetchServerSentEvents(apiTarget),
      id: clientId,
      initialMessages: messagesToUse as any,
      body: {
        conversationId: optionsRef.current.conversationId,
        provider: optionsRef.current.provider,
        model: optionsRef.current.model,
        displayTimezone: browserTimeZone(),
        locationOverride: optionsRef.current.locationOverride,
      },
      tools,
      onCustomEvent: handleCustomEvent,
      onError: (nextError: Error) => {
        optionsRef.current.onError?.(nextError)
      },
      onFinish: () => {
        optionsRef.current.onFinish?.()
      },
      onMessagesChange: (nextMessages) => {
        setMessages(nextMessages as Array<UIMessage>)
      },
      onLoadingChange: setIsLoading,
      onErrorChange: setError,
      onStatusChange: setStatus,
      onSubscriptionChange: setIsSubscribed,
      onConnectionStatusChange: setConnectionStatus,
      onSessionGeneratingChange: setSessionGenerating,
    })
  }, [
    apiTarget,
    clientId,
    handleCustomEvent,
    localCliMode,
    tools,
    options.initialMessages,
  ])

  useEffect(() => {
    if (!client) {
      return
    }

    client.updateOptions({
      body: {
        conversationId: options.conversationId,
        provider: options.provider,
        model: options.model,
        displayTimezone: browserTimeZone(),
        locationOverride: options.locationOverride,
      },
      onCustomEvent: handleCustomEvent,
      onError: (nextError: Error) => {
        options.onError?.(nextError)
      },
      onFinish: () => {
        options.onFinish?.()
      },
      tools,
    })
  }, [
    client,
    options.conversationId,
    options.locationOverride,
    options.model,
    options.onError,
    options.onFinish,
    options.provider,
    handleCustomEvent,
    tools,
  ])

  useEffect(() => {
    if (!client) {
      return
    }

    if (options.initialMessages.length > 0 && messages.length === 0) {
      client.setMessagesManually(options.initialMessages as any)
    }
  }, [client, messages.length, options.initialMessages])

  useEffect(() => {
    return () => {
      if (client) {
        client.stop()
      }
      if (localCliRunRef.current) {
        localCliRunRef.current.cancelled = true
      }
    }
  }, [client])

  const runLocalCliMessage = useCallback(
    async (content: string, extraBody?: SendMessageOptions) => {
      const desktopBridge = getDesktopBridge()
      if (!desktopBridge) {
        throw new Error('Desktop local CLI is unavailable in this shell.')
      }

      const requestId =
        extraBody?.clientRequestId?.trim() ||
        `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const userMessage: UIMessage = {
        id: requestId,
        role: 'user',
        parts: [
          {
            type: 'text',
            content,
          },
        ],
        createdAt: new Date(),
      } as unknown as UIMessage

      setError(undefined)
      setIsLoading(true)
      setConnectionStatus('connected')
      setSessionGenerating(false)
      setMessages((current) => [...current, userMessage])
      localCliRunRef.current = {
        cancelled: false,
      }

      const unsubscribe = desktopBridge.onLocalCliProgress((event) => {
        if (localCliRunRef.current?.cancelled) {
          return
        }

        optionsRef.current.onCustomEvent?.(
          'tool-progress',
          { label: event.label },
          {},
        )
      })

      try {
        const result = await desktopBridge.runLocalCliChat({
          apiBaseUrl: getDesktopApiBaseUrl(),
          conversationId: optionsRef.current.conversationId,
          message: content,
          clientMessageId: requestId,
          providerId:
            optionsRef.current.provider === 'anthropic'
              ? 'anthropic'
              : 'openai',
          model: optionsRef.current.model ?? '',
          route: {
            transport: 'local-cli',
            source: 'desktop-local-cli',
          },
          context: {
            location: extraBody?.locationOverride
              ? {
                  label: extraBody.locationOverride.label,
                  latitude: extraBody.locationOverride.latitude,
                  longitude: extraBody.locationOverride.longitude,
                  timezone: extraBody.locationOverride.timezone,
                }
              : null,
            units: optionsRef.current.units ?? 'imperial',
            timeDisplay: optionsRef.current.timeDisplay ?? 'user-local',
            answerTone: optionsRef.current.answerTone ?? 'casual',
            displayTimezone: browserTimeZone(),
          },
        })

        if (localCliRunRef.current?.cancelled) {
          return
        }

        const [assistantMessage] = mapRecordsToUiMessages([
          result.message as MessageRecord,
        ])
        if (assistantMessage) {
          setMessages((current) => [...current, assistantMessage])
        }
        optionsRef.current.onFinish?.()
      } catch (nextError) {
        if (localCliRunRef.current?.cancelled) {
          return
        }

        const typedError =
          nextError instanceof Error
            ? nextError
            : new Error('Local CLI request failed.')
        setError(typedError)
        optionsRef.current.onError?.(typedError)
        throw typedError
      } finally {
        unsubscribe()
        if (localCliRunRef.current) {
          localCliRunRef.current.cancelled = false
        }
        setIsLoading(false)
        setStatus('ready')
        setSessionGenerating(false)
      }
    },
    [],
  )

  const sendMessage = useCallback(
    async (content: string, extraBody?: SendMessageOptions) => {
      const trimmed = content.trim()
      const requestId = extraBody?.clientRequestId?.trim()

      if (!trimmed) {
        return
      }

      if (requestId) {
        if (sentRequestIdsRef.current.has(requestId)) {
          return
        }

        sentRequestIdsRef.current.add(requestId)
      }

      try {
        if (localCliMode) {
          await runLocalCliMessage(trimmed, extraBody)
          return
        }

        await client?.sendMessage(
          requestId
            ? {
                content: trimmed,
                id: requestId,
              }
            : trimmed,
          extraBody,
        )
      } catch (sendError) {
        if (requestId) {
          sentRequestIdsRef.current.delete(requestId)
        }
        throw sendError
      }
    },
    [client, localCliMode, runLocalCliMessage],
  )

  const append = useCallback(
    async (message: ModelMessage | UIMessage) => {
      if (client) {
        await client.append(message as any)
        return
      }

      setMessages((current) => [...current, message as UIMessage])
    },
    [client],
  )

  const reload = useCallback(async () => {
    if (client) {
      await client.reload()
      return
    }

    const lastUserMessage = [...messagesRef.current]
      .reverse()
      .find((message) => message.role === 'user')
    const text = lastUserMessage ? extractUiMessageText(lastUserMessage) : ''
    if (text.trim()) {
      await sendMessage(text)
    }
  }, [client, sendMessage])

  const stop = useCallback(() => {
    if (client) {
      client.stop()
      return
    }

    if (localCliRunRef.current) {
      localCliRunRef.current.cancelled = true
    }
    setIsLoading(false)
    setStatus('ready')
  }, [client])

  const clear = useCallback(() => {
    if (client) {
      client.clear()
      return
    }

    setMessages([])
  }, [client])

  const setMessagesManually = useCallback(
    (nextMessages: Array<UIMessage>) => {
      if (client) {
        client.setMessagesManually(nextMessages as any)
        return
      }

      setMessages(nextMessages)
    },
    [client],
  )

  const addToolResult = useCallback(
    async (result: {
      toolCallId: string
      tool: string
      output: unknown
      state?: 'output-available' | 'output-error'
      errorText?: string
    }) => {
      if (client) {
        await client.addToolResult(result)
      }
    },
    [client],
  )

  const addToolApprovalResponse = useCallback(
    async (response: { id: string; approved: boolean }) => {
      if (client) {
        await client.addToolApprovalResponse(response)
      }
    },
    [client],
  )

  return {
    messages,
    runtimeInfo,
    apiTarget,
    sendMessage,
    append,
    reload,
    stop,
    isLoading,
    error,
    status,
    isSubscribed,
    connectionStatus,
    sessionGenerating,
    setMessages: setMessagesManually,
    clear,
    addToolResult,
    addToolApprovalResponse,
  }
}
