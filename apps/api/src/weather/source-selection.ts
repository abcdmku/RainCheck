import type {
  RequestClassification,
  WeatherSourceCatalogEntry,
} from '@raincheck/contracts'

import { weatherSourceCatalog } from '@raincheck/contracts'

const sourcePriority: Record<string, number> = {
  'weather-gov': 1,
  spc: 2,
  wpc: 3,
  nwps: 4,
  nexrad: 5,
  goes: 6,
  mrms: 7,
  'aviationweather-gov': 8,
  href: 9,
  hrrr: 10,
  rap: 11,
  nam: 12,
  nbm: 13,
  rtma: 14,
  urma: 15,
  'wpc-medium': 16,
  gfs: 17,
  gefs: 18,
  'ecmwf-open-data': 19,
  nhc: 20,
  wavewatch3: 21,
  rtofs: 22,
  'upper-air': 23,
  'ncei-cdo': 24,
  'ncei-storm-events': 25,
  'us-census-geocoder': 30,
  'open-meteo-geocoding': 31,
  geonames: 32,
}

function orderEntries(
  entries: Array<WeatherSourceCatalogEntry>,
  requestedSourceIds: Array<string>,
) {
  const requestOrder = new Map(
    requestedSourceIds.map((sourceId, index) => [sourceId, index]),
  )

  return [...entries].sort((left, right) => {
    const leftRequestRank =
      requestOrder.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER
    const rightRequestRank =
      requestOrder.get(right.sourceId) ?? Number.MAX_SAFE_INTEGER
    if (leftRequestRank !== rightRequestRank) {
      return leftRequestRank - rightRequestRank
    }

    const leftRank = sourcePriority[left.sourceId] ?? 999
    const rightRank = sourcePriority[right.sourceId] ?? 999
    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }

    return left.sourceId.localeCompare(right.sourceId)
  })
}

function selectEntries(sourceIds: Array<string>) {
  const set = new Set(sourceIds)
  return orderEntries(
    weatherSourceCatalog.filter((entry) => set.has(entry.sourceId)),
    sourceIds,
  )
}

function sourceIdsForIntent(intent: RequestClassification['intent']) {
  switch (intent) {
    case 'current-conditions':
    case 'forecast':
    case 'alerts':
      return ['weather-gov', 'us-census-geocoder', 'open-meteo-geocoding']
    case 'aviation':
      return ['aviationweather-gov', 'weather-gov']
    case 'severe-weather':
      return [
        'spc',
        'weather-gov',
        'nexrad',
        'goes',
        'mrms',
        'href',
        'hrrr',
        'rap',
        'nam',
        'nbm',
        'rtma',
        'urma',
      ]
    case 'fire-weather':
      return ['spc-fire', 'weather-gov']
    case 'precipitation':
      return ['wpc', 'nwps', 'weather-gov', 'mrms']
    case 'hydrology':
      return ['nwps', 'wpc', 'weather-gov', 'mrms']
    case 'winter-weather':
      return ['wpc-winter', 'weather-gov', 'href', 'hrrr', 'nam', 'nbm']
    case 'medium-range':
      return ['wpc-medium', 'gfs', 'gefs', 'ecmwf-open-data', 'weather-gov']
    case 'radar':
    case 'radar-analysis':
    case 'satellite':
    case 'mrms':
      return ['nexrad', 'goes', 'mrms', 'weather-gov', 'spc']
    case 'short-range-model':
    case 'blend-analysis':
      return ['href', 'hrrr', 'rap', 'nam', 'nbm', 'rtma', 'urma', 'weather-gov']
    case 'global-model':
      return ['wpc-medium', 'gfs', 'gefs', 'ecmwf-open-data', 'weather-gov']
    case 'tropical':
      return ['nhc', 'weather-gov']
    case 'marine':
      return ['wavewatch3', 'rtofs', 'weather-gov']
    case 'upper-air':
      return ['upper-air', 'spc', 'weather-gov']
    case 'historical-climate':
      return ['ncei-cdo', 'weather-gov']
    case 'storm-history':
      return ['ncei-storm-events', 'ncei-cdo', 'weather-gov']
    case 'research-brief':
    case 'weather-analysis':
      return [
        'weather-gov',
        'spc',
        'wpc',
        'nwps',
        'nexrad',
        'goes',
        'mrms',
        'href',
        'hrrr',
        'rap',
        'nam',
        'nbm',
        'rtma',
        'urma',
        'gfs',
        'gefs',
        'ecmwf-open-data',
        'upper-air',
        'ncei-cdo',
        'ncei-storm-events',
        'us-census-geocoder',
        'open-meteo-geocoding',
      ]
    default:
      return ['weather-gov', 'us-census-geocoder', 'open-meteo-geocoding']
  }
}

function reasonForSource(
  intent: RequestClassification['intent'],
  entry: WeatherSourceCatalogEntry,
) {
  switch (entry.sourceId) {
    case 'weather-gov':
      return 'Official forecasts, observations, and alerts should anchor the final answer.'
    case 'spc':
    case 'spc-fire':
      return 'SPC official outlook context should lead severe and fire-weather reasoning.'
    case 'wpc':
    case 'wpc-winter':
    case 'wpc-medium':
      return 'WPC products add the impact-oriented precipitation, winter, and medium-range context.'
    case 'nwps':
      return 'River and flood questions should lead with NWPS gauge and forecast context.'
    case 'nexrad':
    case 'goes':
    case 'mrms':
      return 'Real-time nowcast sources should outrank model guidance for current and near-term questions.'
    case 'href':
    case 'hrrr':
    case 'rap':
    case 'nam':
    case 'nbm':
    case 'rtma':
    case 'urma':
      return 'Short-range guidance should support the answer after official context and observations are established.'
    case 'gfs':
    case 'gefs':
    case 'ecmwf-open-data':
      return 'Global guidance should be synthesized into one day 2 to day 10 pattern call with uncertainty.'
    case 'aviationweather-gov':
      return 'Aviation products should lead airport and flight-weather answers.'
    case 'ncei-cdo':
    case 'ncei-storm-events':
      return 'Historical and climate questions should use NOAA archival sources instead of current forecast products.'
    default:
      return `Selected for the ${intent} workflow.`
  }
}

export function chooseSourceManifests(classification: RequestClassification) {
  return selectEntries(sourceIdsForIntent(classification.intent)).map(
    (entry, index) => ({
      sourceId: entry.sourceId,
      productId: entry.productId,
      rank: index + 1,
      reason: reasonForSource(classification.intent, entry),
    }),
  )
}
