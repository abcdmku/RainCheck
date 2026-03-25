import {
  copyTextToolDef,
  openArtifactToolDef,
  requestGeolocationPermissionToolDef,
  saveUiPreferenceToolDef,
} from '@raincheck/contracts'
import { clientTools, fetchServerSentEvents } from '@tanstack/ai-client'
import { useChat } from '@tanstack/ai-react'
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

export function useRainCheckChat(options: {
  conversationId: string
  initialMessages: Array<any>
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
  return useChat<any>({
    id: options.conversationId,
    initialMessages: options.initialMessages as any,
    connection: fetchServerSentEvents(resolveApiUrl('/api/chat')),
    body: {
      conversationId: options.conversationId,
      provider: options.provider,
      model: options.model,
      locationOverride: options.locationOverride,
    },
    tools: clientTools(
      geolocationTool,
      openArtifactTool,
      copyTool,
      savePreferenceTool,
    ),
    onCustomEvent: options.onCustomEvent,
    onError: options.onError,
    onFinish: () => {
      options.onFinish?.()
    },
  }) as any
}
