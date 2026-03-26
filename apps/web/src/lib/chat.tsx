import {
  copyTextToolDef,
  openArtifactToolDef,
  requestGeolocationPermissionToolDef,
  saveUiPreferenceToolDef,
} from '@raincheck/contracts'
import type { ModelMessage, UIMessage } from '@tanstack/ai'
import {
  ChatClient,
  clientTools,
  fetchServerSentEvents,
  type ChatClientState,
  type ConnectionStatus,
} from '@tanstack/ai-client'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { resolveApiUrl } from './api'
import type { ChatLocationOverride } from './location'

const geolocationTool = requestGeolocationPermissionToolDef.client(async () => {
  const position = await new Promise<GeolocationPosition>((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject)
  })

  return {
    name: 'Current device location',
    label: 'Current device location',
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
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

export function useRainCheckChat(options: {
  conversationId: string
  initialMessages: Array<UIMessage>
  provider?: string
  model?: string
  locationOverride?: ChatLocationOverride
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
  const messagesRef = useRef(options.initialMessages)
  const isFirstMountRef = useRef(true)
  const optionsRef = useRef(options)

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

  const client = useMemo(() => {
    const messagesToUse = isFirstMountRef.current
      ? options.initialMessages
      : messagesRef.current

    isFirstMountRef.current = false

    return new ChatClient({
      connection: fetchServerSentEvents(resolveApiUrl('/api/chat')),
      id: clientId,
      initialMessages: messagesToUse as any,
      body: {
        conversationId: optionsRef.current.conversationId,
        provider: optionsRef.current.provider,
        model: optionsRef.current.model,
        locationOverride: optionsRef.current.locationOverride,
      },
      tools,
      onCustomEvent: optionsRef.current.onCustomEvent,
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
  }, [clientId, tools, options.initialMessages])

  useEffect(() => {
    client.updateOptions({
      body: {
        conversationId: options.conversationId,
        provider: options.provider,
        model: options.model,
        locationOverride: options.locationOverride,
      },
      onCustomEvent: options.onCustomEvent,
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
    options.onCustomEvent,
    options.onError,
    options.onFinish,
    options.provider,
    tools,
  ])

  useEffect(() => {
    if (options.initialMessages.length > 0 && messages.length === 0) {
      client.setMessagesManually(options.initialMessages as any)
    }
  }, [])

  useEffect(() => {
    return () => {
      client.stop()
    }
  }, [client])

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
        await client.sendMessage(
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
    [client],
  )

  const append = useCallback(
    async (message: ModelMessage | UIMessage) => {
      await client.append(message as any)
    },
    [client],
  )

  const reload = useCallback(async () => {
    await client.reload()
  }, [client])

  const stop = useCallback(() => {
    client.stop()
  }, [client])

  const clear = useCallback(() => {
    client.clear()
  }, [client])

  const setMessagesManually = useCallback(
    (nextMessages: Array<UIMessage>) => {
      client.setMessagesManually(nextMessages as any)
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
      await client.addToolResult(result)
    },
    [client],
  )

  const addToolApprovalResponse = useCallback(
    async (response: { id: string; approved: boolean }) => {
      await client.addToolApprovalResponse(response)
    },
    [client],
  )

  return {
    messages,
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
