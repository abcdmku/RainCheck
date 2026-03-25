import {
  type RequestClassification,
  requestClassificationSchema,
} from '@raincheck/contracts'

function includesAny(input: string, terms: Array<string>) {
  return terms.some((term) => input.includes(term))
}

function normalizeClassificationInput(message: string) {
  return message
    .toLowerCase()
    .replace(/\bstrorms?\b/g, 'storms')
    .replace(/\bstrorm\b/g, 'storm')
    .replace(/\bnextg\b/g, 'next')
    .replace(/\bsever\b/g, 'severe')
    .replace(/\s+/g, ' ')
    .trim()
}

const researchTerms = [
  'research',
  'brief',
  'report',
  'deep dive',
  'analysis',
  'explain',
]

const artifactTerms = [
  'loop',
  'chart',
  'plot',
  'artifact',
  'skewt',
  'skew-t',
  'meteogram',
  'pdf',
]

const aviationTerms = [
  'aviation',
  'metar',
  'taf',
  'ifr',
  'mvfr',
  'vfr',
  'airport',
  'sigmet',
  'g-airmet',
  'gairmet',
  'pirep',
  'cwa',
]

const tropicalTerms = [
  'hurricane',
  'tropical storm',
  'tropical depression',
  'nhc',
  'cone',
  'landfall',
  'invest',
]

const marineTerms = [
  'marine',
  'ocean',
  'wave',
  'waves',
  'swell',
  'sst',
  'sea surface',
  'ocean current',
  'ocean currents',
  'sea current',
  'sea currents',
  'rtofs',
  'wavewatch',
  'buoy',
]

const upperAirTerms = [
  'sounding',
  'skewt',
  'skew-t',
  'cape',
  'shear',
  'lapse rate',
  'hodograph',
  'parcel',
]

const fireWeatherTerms = [
  'fire weather',
  'wildfire',
  'red flag',
  'brush fire',
  'spread risk',
]

const hydrologyTerms = [
  'river',
  'stream',
  'gauge',
  'streamflow',
  'river level',
  'flood stage',
  'hydrology',
]

const radarTerms = ['radar', 'reflectivity', 'velocity', 'mesocyclone']
const satelliteTerms = [
  'satellite',
  'water vapor',
  'cloud top',
  'glm',
  'fog',
  'smoke',
  'infrared',
  'visible imagery',
]

const mrmsTerms = [
  'mrms',
  'qpe',
  'precip rate',
  'precipitation rate',
  'lowest altitude reflectivity',
]

const precipitationTerms = [
  'qpf',
  'excessive rainfall',
  'ero',
  'flash flood',
  'rainfall total',
  'rain totals',
]

const winterTerms = [
  'snow',
  'ice',
  'freezing rain',
  'sleet',
  'blizzard',
  'winter storm',
]

const severeTerms = [
  'tornado',
  'hail',
  'damaging wind',
  'severe thunderstorm',
  'convective',
  'mesoscale',
  'storm prediction center',
  'spc',
  'storm setup',
  'convective outlook',
  'enhanced risk',
  'slight risk',
  'moderate risk',
  'high risk',
  'severe',
  'chase target',
]

const shortRangeModelTerms = [
  'hrrr',
  'rap',
  'nam',
  'href',
  'convective timing',
  'fog timing',
  'snow band',
]

const blendAnalysisTerms = ['nbm', 'rtma', 'urma', 'blend', 'surface analysis']

const globalModelTerms = [
  'gfs',
  'gefs',
  'ecmwf',
  'ifs',
  'aifs',
  'synoptic',
  'pattern',
  'days 2-10',
  'medium range',
]

const stormHistoryTerms = [
  'storm history',
  'storm events',
  'outbreak history',
  'what happened',
  'storm data',
]

const historicalClimateTerms = [
  'climate',
  'normal',
  'normals',
  'anomaly',
  'historical',
  'on this date',
  'record high',
  'record low',
]

const alertTerms = ['alert', 'warning', 'watch', 'advisory']

const genericModelTerms = [
  'current models',
  'current model',
  'latest models',
  'latest model',
  'model guidance',
  'ensemble guidance',
  'models say',
  'what do the models say',
]

const broadStormLocatorTerms = [
  'where are the best storms',
  'where are the most severe storms',
  'where are storms happening',
  'where will the best storms be',
  'where will the most severe storms be',
  'best storms happening',
  'most severe storms happening',
]

function inferTimeHorizonHours(input: string) {
  const nextDayMatch = input.match(/\bnext\s+([1-9]|10)\s*[- ]?days?\b/)
  if (nextDayMatch?.[1]) {
    return Number(nextDayMatch[1]) * 24
  }

  const dayWindowMatch = input.match(/\b([1-9]|10)\s*[- ]?days?\b/)
  if (dayWindowMatch?.[1]) {
    return Number(dayWindowMatch[1]) * 24
  }

  const numberedDayMatch = input.match(/\bday\s*([1-9]|10)\b/)
  if (numberedDayMatch?.[1]) {
    return Number(numberedDayMatch[1]) * 24
  }

  if (
    includesAny(input, [
      'next 10 days',
      'days 2-10',
      'day 7',
      'week',
      'weekend',
    ])
  ) {
    return 240
  }

  if (
    includesAny(input, ['tomorrow', 'tonight', '48 hours', '2 days', 'day 2'])
  ) {
    return 48
  }

  if (
    includesAny(input, [
      'today',
      'this afternoon',
      'this evening',
      'next 12 hours',
    ])
  ) {
    return 12
  }

  return 6
}

function hasMultipleModelMentions(input: string) {
  const modelTokens = [
    'hrrr',
    'rap',
    'nam',
    'href',
    'nbm',
    'rtma',
    'urma',
    'gfs',
    'gefs',
    'ecmwf',
    'ifs',
    'aifs',
  ]
  return modelTokens.filter((token) => input.includes(token)).length >= 2
}

function buildClassification(
  intent: RequestClassification['intent'],
  input: string,
  options: {
    taskClass?: RequestClassification['taskClass']
    needsArtifact?: boolean
    timeHorizonHours?: number
    locationRequired?: boolean
  } = {},
): RequestClassification {
  const researchRequested = includesAny(input, researchTerms)
  const artifactRequested = includesAny(input, artifactTerms)
  const defaultNeedsArtifact =
    artifactRequested ||
    researchRequested ||
    ['radar', 'satellite', 'upper-air', 'storm-history', 'radar-analysis'].includes(intent)
  const needsArtifact = options.needsArtifact ?? defaultNeedsArtifact

  const defaultTaskClass =
    researchRequested ||
    [
      'upper-air',
      'historical-climate',
      'storm-history',
      'research-brief',
      'radar-analysis',
      'weather-analysis',
    ].includes(intent)
      ? 'research'
      : 'chat'
  const taskClass = options.taskClass ?? defaultTaskClass

  return requestClassificationSchema.parse({
    taskClass,
    intent,
    timeHorizonHours: options.timeHorizonHours ?? inferTimeHorizonHours(input),
    locationRequired: options.locationRequired ?? true,
    needsArtifact,
  })
}

function includesSevereSignal(input: string) {
  return (
    includesAny(input, severeTerms) ||
    includesAny(input, [
      'best storms',
      'storms happening',
      'storm corridor',
      'storm chase',
      'tornado target',
    ]) ||
    (input.includes('storm') && input.includes('severe'))
  )
}

function isComparisonPrompt(input: string) {
  return includesAny(input, ['compare', 'comparison', 'versus', 'vs'])
}

export function classifyRequest(message: string): RequestClassification {
  const normalized = normalizeClassificationInput(message)
  const timeHorizonHours = inferTimeHorizonHours(normalized)
  const broadStormLocator =
    includesAny(normalized, broadStormLocatorTerms) ||
    ((normalized.includes('where are') || normalized.includes('where will')) &&
      includesSevereSignal(normalized))
  const modelDrivenStormAnalysis =
    broadStormLocator && includesAny(normalized, genericModelTerms)

  if (modelDrivenStormAnalysis) {
    return buildClassification('weather-analysis', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      locationRequired: false,
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, aviationTerms)) {
    return buildClassification('aviation', normalized, {
      timeHorizonHours: 12,
      needsArtifact: includesAny(normalized, artifactTerms),
    })
  }

  if (includesAny(normalized, tropicalTerms)) {
    return buildClassification('tropical', normalized)
  }

  if (includesAny(normalized, marineTerms)) {
    return buildClassification('marine', normalized)
  }

  if (includesAny(normalized, upperAirTerms)) {
    return buildClassification('upper-air', normalized)
  }

  if (includesAny(normalized, stormHistoryTerms)) {
    return buildClassification('storm-history', normalized, {
      timeHorizonHours: 720,
    })
  }

  if (includesAny(normalized, historicalClimateTerms)) {
    return buildClassification('historical-climate', normalized, {
      timeHorizonHours: 720,
    })
  }

  if (includesAny(normalized, fireWeatherTerms)) {
    return buildClassification('fire-weather', normalized)
  }

  if (includesAny(normalized, hydrologyTerms)) {
    return buildClassification('hydrology', normalized, {
      taskClass: 'research',
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, radarTerms)) {
    return buildClassification(
      includesAny(normalized, researchTerms) || includesAny(normalized, artifactTerms)
        ? 'radar-analysis'
        : 'radar',
      normalized,
    )
  }

  if (includesAny(normalized, satelliteTerms)) {
    return buildClassification('satellite', normalized)
  }

  if (includesAny(normalized, mrmsTerms)) {
    return buildClassification('mrms', normalized)
  }

  if (
    isComparisonPrompt(normalized) &&
    hasMultipleModelMentions(normalized)
  ) {
    if (includesAny(normalized, globalModelTerms) || timeHorizonHours > 48) {
      return buildClassification('global-model', normalized, {
        taskClass: 'research',
        timeHorizonHours,
        needsArtifact: false,
      })
    }

    return buildClassification('short-range-model', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, genericModelTerms)) {
    if (includesAny(normalized, globalModelTerms) || timeHorizonHours > 48) {
      return buildClassification('global-model', normalized, {
        taskClass: 'research',
        timeHorizonHours,
        needsArtifact: false,
      })
    }

    return buildClassification('short-range-model', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      needsArtifact: false,
    })
  }

  const severeShortRangeAnalysis =
    includesAny(normalized, shortRangeModelTerms) && includesSevereSignal(normalized)

  if (severeShortRangeAnalysis) {
    return buildClassification('severe-weather', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      locationRequired: !broadStormLocator,
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, blendAnalysisTerms)) {
    return buildClassification('blend-analysis', normalized, {
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, shortRangeModelTerms)) {
    return buildClassification('short-range-model', normalized, {
      taskClass: hasMultipleModelMentions(normalized) ? 'research' : 'chat',
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, globalModelTerms)) {
    return buildClassification('global-model', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, winterTerms)) {
    return buildClassification('winter-weather', normalized)
  }

  if (includesAny(normalized, precipitationTerms)) {
    return buildClassification('precipitation', normalized, {
      taskClass: 'research',
      needsArtifact: false,
    })
  }

  if (includesSevereSignal(normalized) || broadStormLocator) {
    return buildClassification('severe-weather', normalized, {
      taskClass:
        broadStormLocator || timeHorizonHours >= 72 ? 'research' : 'chat',
      timeHorizonHours,
      locationRequired: !broadStormLocator,
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, alertTerms)) {
    return buildClassification('alerts', normalized, {
      timeHorizonHours: 12,
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, [...researchTerms, 'weather analysis'])) {
    return buildClassification('weather-analysis', normalized, {
      taskClass: 'research',
      needsArtifact: false,
      locationRequired: false,
    })
  }

  if (
    includesAny(normalized, [
      'forecast',
      'tomorrow',
      'tonight',
      'week',
      'rain',
      'this weekend',
    ])
  ) {
    return buildClassification('forecast', normalized, {
      needsArtifact: false,
    })
  }

  return buildClassification('current-conditions', normalized, {
    taskClass: 'chat',
    needsArtifact: false,
    timeHorizonHours: 6,
  })
}
