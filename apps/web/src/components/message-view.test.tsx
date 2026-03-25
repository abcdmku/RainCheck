// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MessageView } from './message-view'

describe('MessageView', () => {
  it('hides helper tool outputs from the transcript', () => {
    render(
      <MessageView
        isLastAssistant
        message={
          {
            id: 'assistant-1',
            role: 'assistant',
            createdAt: new Date(),
            parts: [
              {
                type: 'text',
                content: 'Central Illinois looks like the focus.',
              },
              {
                type: 'tool-call',
                id: 'tool-1',
                name: 'request_geolocation_permission',
                arguments: '{}',
                state: 'input-complete',
                output: {
                  name: 'Current device location',
                  latitude: 40,
                  longitude: -89,
                },
              },
            ],
          } as any
        }
        onCopy={vi.fn()}
        onEditAndResend={vi.fn()}
        onOpenArtifact={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Central Illinois looks like the focus.'),
    ).toBeTruthy()
    expect(screen.queryByText('Location')).toBeNull()
    expect(screen.queryByText(/Resolved to/i)).toBeNull()
  })

  it('keeps synthesis tool output out of the transcript', () => {
    render(
      <MessageView
        isLastAssistant
        message={
          {
            id: 'assistant-2',
            role: 'assistant',
            createdAt: new Date(),
            parts: [
              {
                type: 'text',
                content: 'Bottom line: the best target is just east of Austin.',
              },
              {
                type: 'tool-call',
                id: 'tool-2',
                name: 'synthesize_weather_conclusion',
                arguments: '{}',
                state: 'input-complete',
                output: {
                  error:
                    'Input validation failed for tool synthesize_weather_conclusion.',
                },
              },
            ],
          } as any
        }
        onCopy={vi.fn()}
        onEditAndResend={vi.fn()}
        onOpenArtifact={vi.fn()}
        onRetry={vi.fn()}
      />,
    )

    expect(
      screen.getByText('Bottom line: the best target is just east of Austin.'),
    ).toBeTruthy()
    expect(screen.queryByText('Weather conclusion')).toBeNull()
    expect(screen.queryByText('Unavailable')).toBeNull()
    expect(screen.queryByText(/Input validation failed/i)).toBeNull()
  })
})
