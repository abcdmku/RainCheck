// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockChatClient,
  sendMessageMock,
  stopMock,
  updateOptionsMock,
} = vi.hoisted(() => {
  const sendMessageMock = vi.fn()
  const updateOptionsMock = vi.fn()
  const stopMock = vi.fn()

  class MockChatClient {
    updateOptions = updateOptionsMock
    sendMessage = sendMessageMock
    append = vi.fn()
    reload = vi.fn()
    stop = stopMock
    clear = vi.fn()
    setMessagesManually = vi.fn()
    addToolResult = vi.fn()
    addToolApprovalResponse = vi.fn()
  }

  return {
    MockChatClient,
    sendMessageMock,
    stopMock,
    updateOptionsMock,
  }
})

vi.mock('@tanstack/ai-client', () => ({
  ChatClient: MockChatClient,
  clientTools: (...tools: Array<unknown>) => tools,
  fetchServerSentEvents: vi.fn(() => ({ connect: vi.fn() })),
}))

import { useRainCheckChat } from './chat'

function Harness() {
  const chat = useRainCheckChat({
    conversationId: 'thread-test',
    initialMessages: [],
  })

  const payload = {
    clientRequestId: 'req-1',
    locationOverride: {
      label: 'Yorkville, IL',
      latitude: 41.6414,
      longitude: -88.4473,
    },
  }

  return (
    <>
      <button onClick={() => void chat.sendMessage('  Storm setup  ', payload)}>
        Send
      </button>
      <button onClick={() => void chat.sendMessage('  Storm setup  ', payload)}>
        Send duplicate
      </button>
    </>
  )
}

describe('useRainCheckChat', () => {
  beforeEach(() => {
    cleanup()
    sendMessageMock.mockReset()
    sendMessageMock.mockResolvedValue(undefined)
    updateOptionsMock.mockReset()
    stopMock.mockReset()
  })

  it('sends a stable user-turn id and forwards per-message body data', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith(
        {
          content: 'Storm setup',
          id: 'req-1',
        },
        {
          clientRequestId: 'req-1',
          locationOverride: {
            label: 'Yorkville, IL',
            latitude: 41.6414,
            longitude: -88.4473,
          },
        },
      )
    })
  })

  it('drops a duplicate send for the same client request id', async () => {
    render(<Harness />)

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send duplicate' }))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledTimes(1)
    })
  })
})
