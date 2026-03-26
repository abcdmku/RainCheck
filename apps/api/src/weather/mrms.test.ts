import { beforeEach, describe, expect, it, vi } from 'vitest'

const { geocodeQueryMock, fetchWeatherTextMock } = vi.hoisted(() => ({
  geocodeQueryMock: vi.fn(),
  fetchWeatherTextMock: vi.fn(),
}))

vi.mock('./geocode', () => ({
  geocodeQuery: geocodeQueryMock,
}))

vi.mock('./runtime', async () => {
  const actual = await vi.importActual<typeof import('./runtime')>('./runtime')
  return {
    ...actual,
    fetchWeatherText: fetchWeatherTextMock,
  }
})

import { getMrmsProducts } from './mrms'

describe('mrms products', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    geocodeQueryMock.mockResolvedValue({
      query: 'Yorkville, IL',
      name: 'Yorkville, Illinois, United States',
      latitude: 41.64,
      longitude: -88.45,
      resolvedBy: 'test',
    })

    fetchWeatherTextMock.mockImplementation(async (_app, target) => ({
      value: `<html><head><title>${target.label}</title></head><body>Skip to main content An official website of the United States government Here's how you know.</body></html>`,
      source: target,
      retrievedAt: '2026-03-25T00:00:00.000Z',
      cached: false,
    }))
  })

  it('returns a safe summary instead of leaking public-site chrome', async () => {
    const result = await getMrmsProducts({} as never, 'Yorkville, IL')

    expect(result.summary).toBe(
      'MRMS context is available for Yorkville, Illinois, United States and supports near-real-time radar composite and precipitation analysis.',
    )
    expect(result.summary).not.toContain('Skip to main content')
    expect(result.summary).not.toContain("Here's how you know")
  })
})
