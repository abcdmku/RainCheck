import type {
  RequestClassification,
  WeatherSourceCatalogEntry,
} from '@raincheck/contracts'

import { weatherSourceCatalog } from '@raincheck/contracts'

function selectEntries(filter: (entry: WeatherSourceCatalogEntry) => boolean) {
  return weatherSourceCatalog.filter(filter)
}

function orderEntries(
  entries: Array<WeatherSourceCatalogEntry>,
  sourceOrder: Array<string>,
) {
  return [...entries].sort(
    (left, right) =>
      sourceOrder.indexOf(left.sourceId) - sourceOrder.indexOf(right.sourceId),
  )
}

export function chooseSourceManifests(classification: RequestClassification) {
  switch (classification.intent) {
    case 'current-conditions':
    case 'forecast':
    case 'alerts':
      return orderEntries(
        selectEntries(
          (entry) =>
            entry.sourceId === 'weather-gov' ||
            entry.sourceId === 'us-census-geocoder' ||
            entry.sourceId === 'nominatim',
        ),
        ['weather-gov', 'us-census-geocoder', 'nominatim'],
      ).map((entry, index) => ({
        sourceId: entry.sourceId,
        productId: entry.productId,
        rank: index + 1,
        reason:
          entry.sourceId === 'weather-gov'
            ? 'Official observations, forecast products, and alerts should lead current weather answers.'
            : 'Location normalization is required before weather products can be fetched.',
      }))
    case 'radar-analysis':
      return [
        ...selectEntries((entry) =>
          ['nexrad', 'mrms', 'weather-gov'].includes(entry.sourceId),
        ),
        ...selectEntries((entry) => entry.sourceId === 'spc'),
      ].map((entry, index) => ({
        sourceId: entry.sourceId,
        productId: entry.productId,
        rank: index + 1,
        reason:
          entry.sourceId === 'weather-gov'
            ? 'Official alerts and forecast context anchor storm interpretation.'
            : 'Radar and severe-weather products are the smallest relevant set for this workflow.',
      }))
    case 'model-comparison':
      return selectEntries((entry) =>
        ['weather-gov', 'gfs', 'gefs', 'ecmwf-open-data', 'hrrr'].includes(
          entry.sourceId,
        ),
      ).map((entry, index) => ({
        sourceId: entry.sourceId,
        productId: entry.productId,
        rank: index + 1,
        reason:
          entry.sourceId === 'weather-gov'
            ? 'Official forecast provides the baseline comparison target.'
            : 'Model guidance is included because the user explicitly asked for model context.',
      }))
    case 'hydrology':
      return selectEntries((entry) =>
        ['nwps', 'weather-gov', 'mrms', 'wpc'].includes(entry.sourceId),
      ).map((entry, index) => ({
        sourceId: entry.sourceId,
        productId: entry.productId,
        rank: index + 1,
        reason:
          entry.sourceId === 'nwps'
            ? 'Official stream forecasts and gauge observations outrank other flood context.'
            : 'Flood context is enriched with rainfall analysis and official rainfall outlooks.',
      }))
    case 'aviation':
      return selectEntries((entry) =>
        ['aviationweather-gov', 'weather-gov'].includes(entry.sourceId),
      ).map((entry, index) => ({
        sourceId: entry.sourceId,
        productId: entry.productId,
        rank: index + 1,
        reason:
          entry.sourceId === 'aviationweather-gov'
            ? 'Aviation products should lead flight-weather answers.'
            : 'Official forecast context can support aviation interpretation.',
      }))
    default:
      return orderEntries(
        selectEntries((entry) =>
          ['weather-gov', 'us-census-geocoder', 'nominatim'].includes(
            entry.sourceId,
          ),
        ),
        ['weather-gov', 'us-census-geocoder', 'nominatim'],
      ).map((entry, index) => ({
        sourceId: entry.sourceId,
        productId: entry.productId,
        rank: index + 1,
        reason:
          entry.sourceId === 'weather-gov'
            ? 'Official forecast and alert products provide the backbone of a concise weather brief.'
            : 'Location normalization is required to fetch the weather brief.',
      }))
  }
}
