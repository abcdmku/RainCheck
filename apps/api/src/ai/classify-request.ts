import {
  type RequestClassification,
  requestClassificationSchema,
} from '@raincheck/contracts'

function includesAny(input: string, terms: Array<string>) {
  return terms.some((term) => input.includes(term))
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
  'panel',
  'artifact',
  'skewt',
  'skew-t',
  'meteogram',
  'pdf',
]

const aviationTerms = ['aviation', 'metar', 'taf', 'ifr', 'mvfr', 'vfr', 'airport', 'sigmet', 'g-airmet', 'gairmet', 'pirep', 'cwa']
const tropicalTerms = ['hurricane', 'tropical storm', 'tropical depression', 'nhc', 'cone', 'landfall', 'invest']
const marineTerms = ['marine', 'ocean', 'wave', 'waves', 'swell', 'sst', 'sea surface', 'current', 'rtofs', 'wavewatch', 'buoy']
const upperAirTerms = ['sounding', 'skewt', 'skew-t', 'cape', 'shear', 'lapse rate', 'hodograph', 'parcel']
const fireWeatherTerms = ['fire weather', 'wildfire', 'red flag', 'brush fire', 'spread risk']
const hydrologyTerms = ['river', 'stream', 'gauge', 'streamflow', 'river level', 'flood stage', 'hydrology']
const radarTerms = ['radar', 'reflectivity', 'velocity', 'mesocyclone']
const satelliteTerms = ['satellite', 'water vapor', 'cloud top', 'glm', 'fog', 'smoke', 'infrared', 'visible imagery']
const mrmsTerms = ['mrms', 'qpe', 'precip rate', 'precipitation rate', 'lowest altitude reflectivity']
const precipitationTerms = ['qpf', 'excessive rainfall', 'ero', 'flash flood', 'rainfall total', 'rain totals']
const winterTerms = ['snow', 'ice', 'freezing rain', 'sleet', 'blizzard', 'winter storm']
const severeTerms = ['tornado', 'hail', 'damaging wind', 'severe thunderstorm', 'convective', 'mesoscale', 'storm prediction center', 'spc', 'storm setup']
const shortRangeModelTerms = ['hrrr', 'rap', 'nam', 'href', 'convective timing', 'fog timing', 'snow band']
const blendAnalysisTerms = ['nbm', 'rtma', 'urma', 'blend', 'surface analysis']
const globalModelTerms = ['gfs', 'gefs', 'ecmwf', 'ifs', 'aifs', 'synoptic', 'pattern', 'days 2-10', 'medium range']
const stormHistoryTerms = ['storm history', 'storm events', 'outbreak history', 'what happened', 'storm data']
const historicalClimateTerms = ['climate', 'normal', 'normals', 'anomaly', 'historical', 'on this date', 'record high', 'record low']
const alertTerms = ['alert', 'warning', 'watch', 'advisory']

function inferTimeHorizonHours(input: string) {
  if (includesAny(input, ['next 10 days', 'days 2-10', 'day 7', 'week', 'weekend'])) {
    return 240
  }

  if (includesAny(input, ['tomorrow', 'tonight', '48 hours', '2 days', 'day 2'])) {
    return 48
  }

  if (includesAny(input, ['today', 'this afternoon', 'this evening', 'next 12 hours'])) {
    return 12
  }

  return 6
}

function hasMultipleModelMentions(input: string) {
  const modelTokens = ['hrrr', 'rap', 'nam', 'href', 'nbm', 'rtma', 'urma', 'gfs', 'gefs', 'ecmwf', 'ifs', 'aifs']
  return modelTokens.filter((token) => input.includes(token)).length >= 2
}

function buildClassification(
  intent: RequestClassification['intent'],
  input: string,
  options: {
    taskClass?: RequestClassification['taskClass']
    needsArtifact?: boolean
    timeHorizonHours?: number
  } = {},
): RequestClassification {
  const researchRequested = includesAny(input, researchTerms)
  const artifactRequested = includesAny(input, artifactTerms)
  const defaultNeedsArtifact =
    artifactRequested ||
    researchRequested ||
    [
      'radar',
      'satellite',
      'model-comparison',
      'upper-air',
      'storm-history',
    ].includes(intent)
  const needsArtifact = options.needsArtifact ?? defaultNeedsArtifact

  const defaultTaskClass =
    researchRequested ||
    [
      'model-comparison',
      'upper-air',
      'historical-climate',
      'storm-history',
      'research-brief',
      'radar-analysis',
    ].includes(intent)
      ? 'research'
      : 'chat'
  const taskClass = options.taskClass ?? defaultTaskClass

  return requestClassificationSchema.parse({
    taskClass,
    intent,
    timeHorizonHours: options.timeHorizonHours ?? inferTimeHorizonHours(input),
    locationRequired: true,
    needsArtifact,
  })
}

export function classifyRequest(message: string): RequestClassification {
  const normalized = message.toLowerCase()

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
    return buildClassification('hydrology', normalized)
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
    includesAny(normalized, ['compare', 'comparison', 'versus', 'vs']) &&
    hasMultipleModelMentions(normalized)
  ) {
    return buildClassification('model-comparison', normalized, {
      timeHorizonHours: inferTimeHorizonHours(normalized),
    })
  }

  if (includesAny(normalized, blendAnalysisTerms)) {
    return buildClassification('blend-analysis', normalized)
  }

  if (includesAny(normalized, shortRangeModelTerms)) {
    return buildClassification('short-range-model', normalized)
  }

  if (includesAny(normalized, globalModelTerms)) {
    return buildClassification(
      hasMultipleModelMentions(normalized) ? 'model-comparison' : 'global-model',
      normalized,
      {
        timeHorizonHours: inferTimeHorizonHours(normalized),
      },
    )
  }

  if (includesAny(normalized, winterTerms)) {
    return buildClassification('winter-weather', normalized)
  }

  if (includesAny(normalized, precipitationTerms)) {
    return buildClassification('precipitation', normalized)
  }

  if (includesAny(normalized, severeTerms)) {
    return buildClassification('severe-weather', normalized)
  }

  if (includesAny(normalized, alertTerms)) {
    return buildClassification('alerts', normalized, {
      timeHorizonHours: 12,
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, [...researchTerms, 'weather analysis'])) {
    return buildClassification('research-brief', normalized)
  }

  if (
    includesAny(normalized, ['forecast', 'tomorrow', 'tonight', 'week', 'rain', 'this weekend'])
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
