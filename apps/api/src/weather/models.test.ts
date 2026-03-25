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

import { getGlobalGuidance, getShortRangeGuidance } from './models'

describe('weather model guidance', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    geocodeQueryMock.mockResolvedValue({
      query: 'Oklahoma City, OK',
      name: 'Oklahoma City, OK',
      latitude: 35.4676,
      longitude: -97.5164,
      region: 'OK',
      country: 'US',
      resolvedBy: 'test',
    })

    fetchWeatherTextMock.mockImplementation(async (_app, target) => ({
      value: `<html><head><title>${target.label}</title></head><body>${target.label} latest guidance context.</body></html>`,
      source: target,
      retrievedAt: '2026-03-25T00:00:00.000Z',
      cached: false,
    }))
  })

  it('returns short-range guidance with model-family cards and specific source pages', async () => {
    const result = await getShortRangeGuidance({} as never, 'Oklahoma City, OK')

    expect(result.location.name).toBe('Oklahoma City, OK')
    expect((result.normalizedForecast.productCards ?? []).map((card) => card.id)).toEqual([
      'href',
      'hrrr',
      'rtma',
      'nbm',
    ])
    expect(result.citations.map((citation) => citation.url)).toEqual(
      expect.arrayContaining([
        'https://nomads.ncep.noaa.gov/gribfilter.php?ds=hrefconus',
        'https://nomads.ncep.noaa.gov/gribfilter.php?ds=hrrr_2d',
        'https://nomads.ncep.noaa.gov/gribfilter.php?ds=rap32',
        'https://nomads.ncep.noaa.gov/gribfilter.php?ds=nam',
      ]),
    )
  })

  it('returns global guidance with GFS, GEFS, and ECMWF cards', async () => {
    const result = await getGlobalGuidance({} as never, 'Oklahoma City, OK')

    expect((result.normalizedForecast.productCards ?? []).map((card) => card.id)).toEqual([
      'ecmwf-open-data',
      'gefs',
      'gfs',
    ])
    expect(result.citations.map((citation) => citation.url)).toEqual(
      expect.arrayContaining([
        'https://nomads.ncep.noaa.gov/gribfilter.php?ds=gfs_0p25',
        'https://nomads.ncep.noaa.gov/gribfilter.php?ds=gefs_atmos_0p25s',
        'https://www.ecmwf.int/en/forecasts/datasets/open-data',
      ]),
    )
  })
})
