import {
  type RequestClassification,
  requestClassificationSchema,
} from '@raincheck/contracts'

function includesAny(input: string, terms: Array<string>) {
  return terms.some((term) => input.includes(term))
}

function inferTimeHorizonHours(input: string) {
  if (includesAny(input, ['next 10 days', 'week', 'days 2-10'])) {
    return 240
  }

  if (includesAny(input, ['tomorrow', 'tonight', '48 hours', '2 days'])) {
    return 48
  }

  if (includesAny(input, ['today', 'this afternoon', 'this evening'])) {
    return 12
  }

  return 6
}

export function classifyRequest(message: string): RequestClassification {
  const normalized = message.toLowerCase()

  if (
    includesAny(normalized, [
      'research',
      'brief',
      'report',
      'deep dive',
      'analysis',
    ])
  ) {
    return requestClassificationSchema.parse({
      taskClass: 'research',
      intent: 'research-brief',
      timeHorizonHours: inferTimeHorizonHours(normalized),
      locationRequired: true,
      needsArtifact: true,
    })
  }

  if (
    includesAny(normalized, [
      'radar',
      'satellite',
      'storm setup',
      'convection',
      'mesoscale',
      'loop',
    ])
  ) {
    return requestClassificationSchema.parse({
      taskClass: 'research',
      intent: 'radar-analysis',
      timeHorizonHours: 6,
      locationRequired: true,
      needsArtifact: includesAny(normalized, ['loop', 'artifact', 'chart']),
    })
  }

  if (
    includesAny(normalized, ['model', 'guidance', 'compare', 'gfs', 'hrrr'])
  ) {
    return requestClassificationSchema.parse({
      taskClass: 'research',
      intent: 'model-comparison',
      timeHorizonHours: inferTimeHorizonHours(normalized),
      locationRequired: true,
      needsArtifact: true,
    })
  }

  if (
    includesAny(normalized, ['flood', 'river', 'stream', 'gauge', 'hydrology'])
  ) {
    return requestClassificationSchema.parse({
      taskClass: 'research',
      intent: 'hydrology',
      timeHorizonHours: inferTimeHorizonHours(normalized),
      locationRequired: true,
      needsArtifact: includesAny(normalized, ['chart', 'brief', 'report']),
    })
  }

  if (includesAny(normalized, ['aviation', 'metar', 'taf', 'ifr', 'airport'])) {
    return requestClassificationSchema.parse({
      taskClass: 'chat',
      intent: 'aviation',
      timeHorizonHours: 12,
      locationRequired: true,
      needsArtifact: false,
    })
  }

  if (includesAny(normalized, ['alert', 'warning', 'watch'])) {
    return requestClassificationSchema.parse({
      taskClass: 'chat',
      intent: 'alerts',
      timeHorizonHours: 12,
      locationRequired: true,
      needsArtifact: false,
    })
  }

  if (
    includesAny(normalized, ['forecast', 'tomorrow', 'tonight', 'week', 'rain'])
  ) {
    return requestClassificationSchema.parse({
      taskClass: 'chat',
      intent: 'forecast',
      timeHorizonHours: inferTimeHorizonHours(normalized),
      locationRequired: true,
      needsArtifact: false,
    })
  }

  return requestClassificationSchema.parse({
    taskClass: 'chat',
    intent: 'current-conditions',
    timeHorizonHours: 6,
    locationRequired: true,
    needsArtifact: false,
  })
}
