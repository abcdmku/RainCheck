import type {
  RequestClassification,
  WeatherSourceCatalogEntry,
} from '@raincheck/contracts'

import { weatherSourceCatalog } from '@raincheck/contracts'

const sourcePriority: Record<string, number> = {
  'weather-gov': 1,
  nwps: 2,
  spc: 3,
  wpc: 4,
  'aviationweather-gov': 5,
  nhc: 6,
  nexrad: 7,
  goes: 8,
  mrms: 9,
  hrrr: 10,
  rap: 11,
  nam: 12,
  href: 13,
  nbm: 14,
  rtma: 15,
  urma: 16,
  gfs: 17,
  gefs: 18,
  'ecmwf-open-data': 19,
  wavewatch3: 20,
  rtofs: 21,
  'upper-air': 22,
  'ncei-cdo': 23,
  'ncei-storm-events': 24,
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
    const leftRequestRank = requestOrder.get(left.sourceId) ?? Number.MAX_SAFE_INTEGER
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
      return ['weather-gov', 'spc', 'nexrad', 'goes', 'mrms']
    case 'fire-weather':
      return ['spc-fire', 'weather-gov']
    case 'precipitation':
      return ['wpc', 'nwps', 'mrms', 'weather-gov']
    case 'winter-weather':
      return ['wpc-winter', 'weather-gov', 'hrrr', 'nam', 'href', 'nbm']
    case 'medium-range':
      return ['wpc-medium', 'gfs', 'gefs', 'ecmwf-open-data']
    case 'hydrology':
      return ['nwps', 'weather-gov', 'mrms', 'wpc']
    case 'radar':
    case 'radar-analysis':
      return ['nexrad', 'mrms', 'weather-gov', 'spc']
    case 'satellite':
      return ['goes', 'weather-gov']
    case 'mrms':
      return ['mrms', 'nexrad', 'weather-gov']
    case 'short-range-model':
      return ['hrrr', 'rap', 'nam', 'href', 'nbm', 'weather-gov']
    case 'blend-analysis':
      return ['nbm', 'rtma', 'urma', 'weather-gov']
    case 'global-model':
    case 'model-comparison':
      return ['gfs', 'gefs', 'ecmwf-open-data', 'wpc-medium', 'weather-gov']
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
      return 'Official public forecast, observations, and alerts should anchor the answer.'
    case 'aviationweather-gov':
      return 'Aviation products should lead airport and flight-weather answers.'
    case 'nwps':
      return 'River and flood-stage questions should lead with NWPS.'
    case 'spc':
    case 'spc-fire':
      return 'SPC outlook context should lead severe and fire-weather risk answers.'
    case 'wpc':
    case 'wpc-winter':
    case 'wpc-medium':
      return 'WPC products add national-scale precipitation, winter, and medium-range hazard context.'
    case 'nhc':
      return 'NHC products should lead public tropical-weather answers.'
    case 'nexrad':
    case 'goes':
    case 'mrms':
      return 'Nowcasting sources should support current-conditions and active-weather timing questions.'
    case 'ncei-cdo':
    case 'ncei-storm-events':
      return 'Historical and climate questions should use archival NOAA sources instead of short-range forecasts.'
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
