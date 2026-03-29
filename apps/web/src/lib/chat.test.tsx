// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  MockChatClient,
  latestOptionsRef,
  sendMessageMock,
  stopMock,
  updateOptionsMock,
} = vi.hoisted(() => {
  const sendMessageMock = vi.fn()
  const updateOptionsMock = vi.fn()
  const stopMock = vi.fn()
  const latestOptionsRef: { current: any } = { current: null }

  class MockChatClient {
    constructor(options: any) {
      latestOptionsRef.current = options
    }
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
    latestOptionsRef,
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
      <button
        onClick={() => void chat.sendMessage('  Storm setup  ', payload)}
        type="button"
      >
        Send
      </button>
      <button
        onClick={() => void chat.sendMessage('  Storm setup  ', payload)}
        type="button"
      >
        Send duplicate
      </button>
      <div data-testid="api-target">{chat.apiTarget}</div>
      <div data-testid="runtime-id">
        {chat.runtimeInfo?.runtimeId ?? 'none'}
      </div>
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
    latestOptionsRef.current = null
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

  it('stores runtime diagnostics from custom chat events', async () => {
    render(<Harness />)

    expect(screen.getByTestId('api-target').textContent).toBe('/api/chat')
    expect(screen.getByTestId('runtime-id').textContent).toBe('none')

    const updatedOptions = updateOptionsMock.mock.calls.at(-1)?.[0]
    updatedOptions?.onCustomEvent?.(
      'runtime-info',
      {
        runtimeId: 'api-1234-rtid',
        startedAt: '2026-03-26T22:00:00.000Z',
        processId: 1234,
        environment: 'development',
        apiBaseUrl: 'http://localhost:3001',
        weatherServiceUrl: 'http://127.0.0.1:8000',
      },
      {},
    )

    await waitFor(() => {
      expect(screen.getByTestId('runtime-id').textContent).toBe('api-1234-rtid')
    })
  })
})
