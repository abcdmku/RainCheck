// @vitest-environment jsdom

import { fireEvent, render, screen, within } from '@testing-library/react'
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

  it('shows short source links under assistant text', () => {
    render(
      <MessageView
        isLastAssistant
        message={
          {
            id: 'assistant-3',
            role: 'assistant',
            createdAt: new Date(),
            citations: [
              {
                id: 'spc-day2',
                label: 'SPC Day 2',
                url: 'https://www.spc.noaa.gov/products/outlook/day2otlk.html',
              },
            ],
            parts: [
              {
                type: 'text',
                content:
                  'From Yorkville, treat late afternoon into evening as the main chase window.',
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

    const [trigger] = screen.getAllByRole('button', { name: /sources/i })
    expect(trigger).toBeTruthy()
    expect(trigger.textContent).toBe('Sources')

    fireEvent.click(trigger)
    expect(screen.getByRole('link', { name: 'SPC Day 2' })).toBeTruthy()
  })

  it('hides derived citations while keeping visible citations sorted by evidence type', () => {
    const view = render(
      <MessageView
        isLastAssistant
        message={
          {
            id: 'assistant-4',
            role: 'assistant',
            createdAt: new Date(),
            parts: [
              {
                type: 'tool-call',
                id: 'tool-4',
                name: 'get_weather_product',
                arguments: '{}',
                state: 'output-available',
                output: {
                  summary: 'The guidance stack favors the image, then the dataset and API.',
                  location: {
                    name: 'Austin, TX',
                    latitude: 30.2672,
                    longitude: -97.7431,
                    resolvedBy: 'test',
                  },
                  data: {},
                  citations: [
                    {
                      id: 'artifact-1',
                      label: 'Generated Artifact',
                      kind: 'artifact',
                      url: 'https://example.com/artifact',
                    },
                    {
                      id: 'page-1',
                      label: 'Context Page',
                      kind: 'page',
                      url: 'https://example.com/page',
                    },
                    {
                      id: 'dataset-1',
                      label: 'Dataset',
                      kind: 'dataset',
                      url: 'https://example.com/dataset',
                    },
                    {
                      id: 'api-1',
                      label: 'API Source',
                      kind: 'api',
                      url: 'https://example.com/api',
                    },
                    {
                      id: 'image-1',
                      label: 'Radar Image',
                      kind: 'image',
                      url: 'https://example.com/image.gif',
                    },
                    {
                      id: 'derived-1',
                      label: 'Derived Product',
                      kind: 'derived',
                      url: 'https://example.com/derived',
                    },
                  ],
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

    const links = Array.from(view.container.querySelectorAll('.source-chip'))
    expect(links.map((link) => link.textContent)).toEqual([
      'Radar Image',
      'Dataset',
      'API Source',
      'Context Page',
      'Generated Artifact',
    ])
    expect(view.container.querySelector('[href="https://example.com/derived"]')).toBeNull()
  })

  it('uses contextUrl when a citation has no direct url', () => {
    const view = render(
      <MessageView
        isLastAssistant
        message={
          {
            id: 'assistant-5',
            role: 'assistant',
            createdAt: new Date(),
            parts: [
              {
                type: 'tool-call',
                id: 'tool-5',
                name: 'get_weather_product',
                arguments: '{}',
                state: 'output-available',
                output: {
                  summary: 'The Day 2 outlook remains the right source to check.',
                  location: {
                    name: 'Austin, TX',
                    latitude: 30.2672,
                    longitude: -97.7431,
                    resolvedBy: 'test',
                  },
                  data: {},
                  citations: [
                    {
                      id: 'spc-day2',
                      label: 'SPC Day 2',
                      kind: 'api',
                      contextUrl:
                        'https://www.spc.noaa.gov/products/outlook/day2otlk.html',
                    },
                  ],
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
      within(view.container)
        .getByRole('link', { name: 'SPC Day 2' })
        .getAttribute('href'),
    ).toBe('https://www.spc.noaa.gov/products/outlook/day2otlk.html')
  })

  it('opens a rendered source view from the sources popup and keeps the raw source inside the viewer', () => {
    const view = render(
      <MessageView
        isLastAssistant
        message={
          {
            id: 'assistant-6',
            role: 'assistant',
            createdAt: new Date(),
            citations: [
              {
                id: 'radar-1',
                label: 'Radar Image',
                kind: 'image',
                displayUrl: 'https://example.com/rendered.gif',
                url: 'https://example.com/raw.gif',
              },
            ],
            parts: [
              {
                type: 'text',
                content: 'The nearby radar image is the best rendered source.',
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

    fireEvent.click(within(view.container).getByRole('button', { name: /sources/i }))

    const renderedSource = within(view.container).getByRole('link', {
      name: 'Radar Image',
    })
    expect(renderedSource.getAttribute('href')).toBe(
      'https://example.com/rendered.gif',
    )

    fireEvent.click(renderedSource)

    const dialog = within(view.container).getByRole('dialog')
    expect(within(dialog).getByRole('img', { name: 'Radar Image' })).toBeTruthy()
    expect(
      within(dialog)
        .getByRole('link', { name: 'Raw source' })
        .getAttribute('href'),
    ).toBe('https://example.com/raw.gif')
  })

  it('prefers a highlighted product url, then contextUrl, then citation fallbacks for preview sources', () => {
    const view = render(
      <MessageView
        isLastAssistant
        message={
          {
            id: 'assistant-6',
            role: 'assistant',
            createdAt: new Date(),
            parts: [
              {
                type: 'tool-call',
                id: 'tool-6',
                name: 'get_weather_product',
                arguments: '{}',
                state: 'output-available',
                output: {
                  summary: 'Short range guidance suggests a focused storm corridor.',
                  location: {
                    name: 'Austin, TX',
                    latitude: 30.2672,
                    longitude: -97.7431,
                    resolvedBy: 'test',
                  },
                  sourceName: 'Short Range Guidance',
                  thumbnailUrl: 'https://example.com/thumb.gif',
                  artifacts: [
                    {
                      artifactId: 'artifact-6',
                      title: 'Preview Artifact',
                      href: 'https://example.com/artifact-view',
                      mimeType: 'image/gif',
                    },
                  ],
                  citations: [
                    {
                      id: 'fallback-source',
                      label: 'Fallback Citation',
                      kind: 'api',
                      contextUrl: 'https://example.com/citation-context',
                    },
                  ],
                  data: {
                    products: [
                      {
                        title: 'Highlighted Product',
                        url: 'https://example.com/product-direct',
                        imageUrl: 'https://example.com/product-image.gif',
                        contextUrl: 'https://example.com/product-context',
                        sourceName: 'Highlighted Product',
                      },
                    ],
                  },
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
      within(view.container)
        .getByRole('link', { name: 'View source' })
        .getAttribute('href'),
    ).toBe(
      'https://example.com/product-direct',
    )

    const fallbackOnly = render(
      <MessageView
        isLastAssistant
        message={
          {
            id: 'assistant-7',
            role: 'assistant',
            createdAt: new Date(),
            parts: [
              {
                type: 'tool-call',
                id: 'tool-7',
                name: 'get_weather_product',
                arguments: '{}',
                state: 'output-available',
                output: {
                  summary: 'Short range guidance suggests a focused storm corridor.',
                  location: {
                    name: 'Austin, TX',
                    latitude: 30.2672,
                    longitude: -97.7431,
                    resolvedBy: 'test',
                  },
                  sourceName: 'Short Range Guidance',
                  thumbnailUrl: 'https://example.com/thumb.gif',
                  artifacts: [
                    {
                      artifactId: 'artifact-7',
                      title: 'Preview Artifact',
                      href: 'https://example.com/artifact-view',
                      mimeType: 'image/gif',
                    },
                  ],
                  citations: [
                    {
                      id: 'fallback-source',
                      label: 'Fallback Citation',
                      kind: 'api',
                      contextUrl: 'https://example.com/citation-context',
                    },
                  ],
                  data: {
                    products: [
                      {
                        title: 'Highlighted Product',
                        imageUrl: 'https://example.com/product-image.gif',
                        sourceName: 'Highlighted Product',
                      },
                    ],
                  },
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
      within(fallbackOnly.container)
        .getByRole('link', { name: 'View source' })
        .getAttribute('href'),
    ).toBe('https://example.com/citation-context')
  })

  it('shows inline loading status for streaming assistant tool work', () => {
    const view = render(
      <MessageView
        isLastAssistant
        isStreaming
        liveStatusLabel="Pinning down the area"
        message={
          {
            id: 'assistant-4',
            role: 'assistant',
            createdAt: new Date(),
            parts: [
              {
                type: 'tool-call',
                id: 'tool-4',
                name: 'resolve_location',
                arguments: '{"locationQuery":"Yorkville, IL"}',
                state: 'output-available',
                output: {
                  query: 'Yorkville, IL',
                  latitude: 41.64114,
                  longitude: -88.44729,
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

    const scoped = within(view.container)

    expect(scoped.getByText('Pinning down the area')).toBeTruthy()
    expect(scoped.queryByLabelText('Retry response')).toBeNull()
    expect(scoped.queryByText(/resolved/i)).toBeNull()
  })
})
