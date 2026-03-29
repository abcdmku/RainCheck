// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { RuntimeDiagnostics } from './runtime-diagnostics'

describe('RuntimeDiagnostics', () => {
  it('renders the connected runtime details when visible', () => {
    render(
      <RuntimeDiagnostics
        visible
        apiTarget="http://localhost:3000/api/chat"
        runtimeInfo={{
          runtimeId: 'api-1234-rtid',
          startedAt: '2026-03-26T22:00:00.000Z',
          processId: 1234,
          environment: 'development',
          apiBaseUrl: 'http://localhost:3001',
          weatherServiceUrl: 'http://127.0.0.1:8000',
        }}
      />,
    )

    const text =
      screen.getByText(/API /i).closest('.thread-runtime-bar')?.textContent ??
      ''
    expect(text).toContain('API http://localhost:3000/api/chat')
    expect(text).toContain('Runtime api-1234-rtid')
    expect(text).toContain('Weather http://127.0.0.1:8000')
  })

  it('renders nothing when hidden', () => {
    const { container } = render(
      <RuntimeDiagnostics
        visible={false}
        apiTarget="http://localhost:3000/api/chat"
        runtimeInfo={null}
      />,
    )

    expect(container.firstChild).toBeNull()
  })

  it('keeps relative API targets stable for SSR and hydration', () => {
    const view = render(
      <RuntimeDiagnostics visible apiTarget="/api/chat" runtimeInfo={null} />,
    )

    expect(view.container.textContent ?? '').toContain('API /api/chat')
  })
})
