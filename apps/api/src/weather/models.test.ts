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

const directModelUrlPatterns = {
  hrrr: /^https:\/\/nomads\.ncep\.noaa\.gov\/pub\/data\/nccf\/com\/hrrr\/prod\/hrrr\.\d{8}\/\d{2}\/conus\/$/,
  rap: /^https:\/\/nomads\.ncep\.noaa\.gov\/pub\/data\/nccf\/com\/rap\/prod\/rap\.\d{8}\/\d{2}\/$/,
  nam: /^https:\/\/nomads\.ncep\.noaa\.gov\/pub\/data\/nccf\/com\/nam\/prod\/nam\.\d{8}\/\d{2}\/$/,
  href: /^https:\/\/nomads\.ncep\.noaa\.gov\/pub\/data\/nccf\/com\/href\/prod\/href\.\d{8}\/\d{2}\/conus\/$/,
  blend: /^https:\/\/nomads\.ncep\.noaa\.gov\/pub\/data\/nccf\/com\/blend\/prod\/blend\.\d{8}\/\d{2}\/$/,
  rtma: /^https:\/\/mag\.ncep\.noaa\.gov\/data\/rtma\/\d{2}\/rtma_mid-west_000_2m_temp\.gif$/,
  urma: /^https:\/\/nomads\.ncep\.noaa\.gov\/pub\/data\/nccf\/com\/urma\/prod\/urma\.\d{8}\/\d{2}\/$/,
  gfs: /^https:\/\/nomads\.ncep\.noaa\.gov\/pub\/data\/nccf\/com\/gfs\/prod\/gfs\.\d{8}\/\d{2}\/atmos\/$/,
  gefs: /^https:\/\/nomads\.ncep\.noaa\.gov\/pub\/data\/nccf\/com\/gefs\/prod\/gefs\.\d{8}\/\d{2}\/atmos\/$/,
}

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

  it('returns short-range guidance with direct upstream URLs only', async () => {
    const result = await getShortRangeGuidance({} as never, 'Oklahoma City, OK')

    expect(result.location.name).toBe('Oklahoma City, OK')
    expect(result.summary).toContain('Short-range guidance source context is available')
    expect(result.summary).not.toContain('gribfilter.php?ds=')
    expect(result.summary).not.toContain('nomads.ncep.noaa.gov/')
    expect((result.normalizedForecast.productCards ?? []).map((card) => card.id)).toEqual([
      'href',
      'hrrr',
      'rtma',
      'nbm',
    ])
    expect(result.data.missingSources).toEqual([])
    expect(result.citations.map((citation) => citation.url)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(directModelUrlPatterns.href),
        expect.stringMatching(directModelUrlPatterns.hrrr),
        expect.stringMatching(directModelUrlPatterns.rap),
        expect.stringMatching(directModelUrlPatterns.nam),
        expect.stringMatching(directModelUrlPatterns.blend),
        expect.stringMatching(directModelUrlPatterns.rtma),
        expect.stringMatching(directModelUrlPatterns.urma),
      ]),
    )
    expect(result.citations.some((citation) => !citation.url?.includes('gribfilter.php?ds='))).toBe(
      true,
    )
  })

  it('returns global guidance with direct model URLs and records ECMWF as missing', async () => {
    const result = await getGlobalGuidance({} as never, 'Oklahoma City, OK')

    expect(result.summary).toContain('Global guidance source context is available')
    expect(result.summary).not.toContain('gribfilter.php?ds=')
    expect((result.normalizedForecast.productCards ?? []).map((card) => card.id)).toEqual([
      'gefs',
      'gfs',
    ])
    expect(result.data.missingSources).toContain('ECMWF Open Data')
    expect(result.citations.map((citation) => citation.url)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(directModelUrlPatterns.gfs),
        expect.stringMatching(directModelUrlPatterns.gefs),
      ]),
    )
    expect(result.citations.some((citation) => citation.url?.includes('gribfilter.php?ds='))).toBe(
      false,
    )
  })
})
