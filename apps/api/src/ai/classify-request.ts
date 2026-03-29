import {
  type RequestClassification,
  requestClassificationSchema,
} from '@raincheck/contracts'
import {
  candidateMentionedInQuestion,
  extractLocationQueryFromQuestion,
  extractStoredWeatherComparisonContext,
} from '../weather/comparison'

const chaseGuidanceRanks = {
  'analysis-only': 0,
  'general-target': 1,
  'exact-target': 2,
  'full-route': 3,
} as const

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
    .replace(/\bweekl\b/g, 'week')
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
  'map',
  'visual',
  'graphic',
  'image',
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

const chaseContextTerms = [
  'chase',
  'target',
  'intercept',
  'storm chasing',
  'storm chase',
]

const generalTargetTerms = [
  'where should i start',
  'where should i head',
  'what time and where',
  'what time should i get there',
  'what time should i start',
  'when should i start',
  'best plan',
  'best target',
  'best spot to start chasing',
  'best place to start chasing',
  'start the chase',
  'follow these storms',
  'where should i go',
  'where should i be',
  'when should i be there',
  'start from',
]

const exactTargetTerms = [
  'which town',
  'what town',
  'which corridor',
  'best corridor',
  'exact target',
  'exact town',
  'specific town',
  'specific corridor',
  'target town',
]

const fullRouteTerms = [
  'full route',
  'turn by turn',
  'turn-by-turn',
  'directions',
  'route',
  'roads',
  'road by road',
  'road-by-road',
  'interception location',
  'intercept directions',
  'intercept route',
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

const beachTerms = ['beach', 'beaches', 'beach day', 'shore', 'coast']

const discoveryRankingTerms = [
  'locations',
  'places',
  'spots',
  'beaches',
  'corridors',
  'targets',
  'areas',
]

const compareRankingTerms = [
  'which one',
  'more favorable',
  'looks better',
  'better one',
  'best one',
  'did you check',
  'what about',
  'how about',
]

const broadStormLocatorTerms = [
  'where are the best storms',
  'where are the most severe storms',
  'where are storms happening',
  'where will the best storms be',
  'where will the most severe storms be',
  'best storms happening',
  'most severe storms happening',
  'where is the best spot to start chasing',
  'best spot to start chasing',
  'best place to start chasing',
  'best spot to chase storms',
  'best place to chase storms',
  'best spot for storms',
  'best place for storms',
]

function isBroadStormSpotterPrompt(input: string) {
  return (
    /\bbest storms? to spot\b/.test(input) ||
    (/\bbest storm\b/.test(input) &&
      (input.includes('spot') || input.includes('currently') || hasTimeSignal(input)))
  )
}

function isBroadStormInterestPrompt(input: string) {
  return (
    /\b(?:any|where|show|check)\s+(?:good|best)\s+storms?\b/.test(input) ||
    (/\bgood\s+storms?\b/.test(input) &&
      (hasTimeSignal(input) || input.includes('currently')))
  )
}

const conversationFollowUpTerms = [
  'what about',
  'how about',
  'what did you check',
  'what did you look at',
  'what did you use',
  'what did you pull',
  'what did you pull up',
  'show on a map',
  'show me on a map',
  'put that on a map',
  'mark the times',
  'mark times',
  'mark where',
  'show that',
  'show me that',
  'can you show',
  'can you put',
  'where should i go',
  'where should i be',
  'when should i be there',
  'should i be there',
]

const coreWeatherTerms = [
  'weather',
  'forecast',
  'current',
  'temperature',
  'wind',
  'humidity',
  'rain',
  'snow',
  'storm',
  'storms',
  'lightning',
  'outlook',
  'warning',
  'watch',
  'advisory',
  'radar',
  'satellite',
  'tornado',
  'hail',
  'flood',
  'cloud',
]

const timeSignalTerms = [
  'today',
  'tonight',
  'tomorrow',
  'this afternoon',
  'this evening',
  'overnight',
  'weekend',
  'this week',
  'next week',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
]

function inferTimeHorizonHours(input: string) {
  const nextDayMatch = input.match(/\bnext\s+([1-9]|10)\s*[- ]?days?\b/)
  if (nextDayMatch?.[1]) {
    return Number(nextDayMatch[1]) * 24
  }

  if (/\bday\s*2\s*(?:and|&)\s*3\b/.test(input)) {
    return 72
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
    chaseGuidanceLevel?: RequestClassification['chaseGuidanceLevel']
    answerMode?: RequestClassification['answerMode']
    candidateMode?: RequestClassification['candidateMode']
    rankLimit?: number
    rankingObjective?: RequestClassification['rankingObjective']
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
      'upper-air',
      'storm-history',
      'radar-analysis',
    ].includes(intent)
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
  const shouldInferChaseGuidanceLevel =
    includesSevereSignal(input) ||
    includesAny(input, [
      ...chaseContextTerms,
      ...generalTargetTerms,
      ...exactTargetTerms,
      ...fullRouteTerms,
    ])
  const chaseGuidanceLevel =
    options.chaseGuidanceLevel ??
    (shouldInferChaseGuidanceLevel
      ? inferChaseGuidanceLevel(input)
      : 'analysis-only')
  const answerMode = options.answerMode ?? inferAnswerMode(input)
  const candidateMode = options.candidateMode ?? inferCandidateMode(input, answerMode)
  const rankLimit = options.rankLimit ?? inferRankLimit(input, answerMode)
  const rankingObjective =
    options.rankingObjective ?? inferRankingObjective(input, intent, answerMode)

  return requestClassificationSchema.parse({
    taskClass,
    intent,
    timeHorizonHours: options.timeHorizonHours ?? inferTimeHorizonHours(input),
    locationRequired: options.locationRequired ?? true,
    needsArtifact,
    chaseGuidanceLevel,
    answerMode,
    candidateMode,
    rankLimit,
    rankingObjective,
  })
}

function hasNamedCandidateSeparator(input: string) {
  if (/\b(?:compare|versus|vs\.?|between|among)\b/.test(input)) {
    return true
  }

  return (
    (input.includes(' or ') || input.includes(' and ')) &&
    includesAny(input, compareRankingTerms)
  )
}

function isDiscoveryRankingPrompt(input: string) {
  return (
    (/\btop\s+\d+\b/.test(input) || /\bbest\b/.test(input)) &&
    includesAny(input, discoveryRankingTerms) &&
    !hasNamedCandidateSeparator(input)
  )
}

function inferAnswerMode(input: string): RequestClassification['answerMode'] {
  if (isDiscoveryRankingPrompt(input)) {
    return 'rank'
  }

  if (hasNamedCandidateSeparator(input)) {
    return includesAny(input, ['top ', 'rank ', 'best ']) ? 'rank' : 'compare'
  }

  return 'single'
}

function inferCandidateMode(
  input: string,
  answerMode: RequestClassification['answerMode'],
): RequestClassification['candidateMode'] {
  if (answerMode === 'single') {
    return 'named'
  }

  return isDiscoveryRankingPrompt(input) ? 'discovered' : 'named'
}

function inferRankLimit(
  input: string,
  answerMode: RequestClassification['answerMode'],
) {
  const topMatch = input.match(/\btop\s+([1-9]|1[0-2])\b/)
  if (topMatch?.[1]) {
    return Number(topMatch[1])
  }

  if (answerMode === 'rank') {
    return 5
  }

  if (answerMode === 'compare') {
    return 2
  }

  return 1
}

function inferRankingObjective(
  input: string,
  intent: RequestClassification['intent'],
  answerMode: RequestClassification['answerMode'],
): RequestClassification['rankingObjective'] {
  if (answerMode === 'single') {
    return undefined
  }

  if (includesAny(input, beachTerms)) {
    return 'beach-day'
  }

  if (intent === 'severe-weather') {
    return 'severe-favorability'
  }

  return 'pleasant-weather'
}

function inferChaseGuidanceLevel(
  input: string,
): RequestClassification['chaseGuidanceLevel'] {
  if (
    includesAny(input, fullRouteTerms) ||
    /\b(?:take|use|follow)\s+(?:i-\d+|us-\d+|highway|route|roads?)\b/.test(input)
  ) {
    return 'full-route'
  }

  if (
    includesAny(input, exactTargetTerms) ||
    /\b(?:town|corridor|county)\s+(?:north|south|east|west|northeast|northwest|southeast|southwest)\s+of\b/.test(
      input,
    ) ||
    /\bexact\b.*\b(?:target|town|corridor)\b/.test(input)
  ) {
    return 'exact-target'
  }

  if (
    includesAny(input, generalTargetTerms) ||
    (includesAny(input, chaseContextTerms) &&
      includesAny(input, ['where', 'when', 'time', 'start', 'plan']))
  ) {
    return 'general-target'
  }

  return 'analysis-only'
}

function includesChaseSignal(input: string) {
  if (includesAny(input, chaseContextTerms)) {
    return true
  }

  if (
    includesAny(input, generalTargetTerms) &&
    includesAny(input, ['storm', 'storms', 'tornado', 'severe'])
  ) {
    return true
  }

  if (
    includesAny(input, [...exactTargetTerms, ...fullRouteTerms]) &&
    includesAny(input, ['chase', 'intercept', 'storm', 'storms', 'tornado'])
  ) {
    return true
  }

  return false
}

function moreSpecificChaseGuidanceLevel(
  previous: RequestClassification['chaseGuidanceLevel'],
  next: RequestClassification['chaseGuidanceLevel'],
): RequestClassification['chaseGuidanceLevel'] {
  return chaseGuidanceRanks[next] > chaseGuidanceRanks[previous]
    ? next
    : previous
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

function isComparisonFollowUpMessage(input: string) {
  return includesAny(input, compareRankingTerms)
}

function extractMessageText(message: any) {
  if (!message) {
    return ''
  }

  if (typeof message.content === 'string') {
    return message.content
  }

  if (!Array.isArray(message.parts)) {
    return ''
  }

  return message.parts
    .filter((part: any) => part?.type === 'text')
    .map((part: any) => String(part.content ?? ''))
    .join('')
}

function latestUserMessageIndex(messages: Array<any>) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user') {
      return index
    }
  }

  return -1
}

function hasTimeSignal(input: string) {
  return (
    includesAny(input, timeSignalTerms) ||
    /\bnext\s+([1-9]|10)\s*[- ]?days?\b/.test(input) ||
    /\b([1-9]|10)\s*[- ]?days?\b/.test(input) ||
    /\bday\s*([1-9]|10)\b/.test(input)
  )
}

function isExplicitWeatherMessage(
  input: string,
  classification: RequestClassification,
) {
  return (
    includesAny(input, coreWeatherTerms) ||
    (classification.intent !== 'current-conditions' &&
      !isConversationFollowUp(input))
  )
}

function isConversationFollowUp(input: string) {
  return (
    includesAny(input, conversationFollowUpTerms) ||
    (includesAny(input, artifactTerms) && !includesAny(input, coreWeatherTerms))
  )
}

function isLocationOnlyWeatherRefinement(input: string) {
  if (
    !input ||
    hasTimeSignal(input) ||
    includesAny(input, coreWeatherTerms) ||
    includesAny(input, researchTerms) ||
    includesAny(input, artifactTerms) ||
    isConversationFollowUp(input)
  ) {
    return false
  }

  if (input.split(/\s+/).filter(Boolean).length > 6) {
    return false
  }

  return extractLocationQueryFromQuestion(input) != null
}

function previousExplicitUserClassification(
  messages: Array<any>,
  latestUserIndex: number,
) {
  for (let index = latestUserIndex - 1; index >= 0; index -= 1) {
    if (messages[index]?.role !== 'user') {
      continue
    }

    const text = extractMessageText(messages[index]).trim()
    if (!text) {
      continue
    }

    const classification = classifyRequest(text)
    if (
      isExplicitWeatherMessage(
        normalizeClassificationInput(text),
        classification,
      )
    ) {
      return classification
    }
  }

  return null
}

function mergeConversationContext(
  input: string,
  latestClassification: RequestClassification,
  previousClassification: RequestClassification,
) {
  const artifactRequested = includesAny(input, artifactTerms)

  return requestClassificationSchema.parse({
    ...previousClassification,
    taskClass:
      previousClassification.taskClass === 'research' || artifactRequested
        ? 'research'
        : previousClassification.taskClass,
    timeHorizonHours: hasTimeSignal(input)
      ? latestClassification.timeHorizonHours
      : previousClassification.timeHorizonHours,
    needsArtifact: previousClassification.needsArtifact || artifactRequested,
    chaseGuidanceLevel: moreSpecificChaseGuidanceLevel(
      previousClassification.chaseGuidanceLevel,
      latestClassification.chaseGuidanceLevel,
    ),
    answerMode:
      latestClassification.answerMode !== 'single'
        ? latestClassification.answerMode
        : previousClassification.answerMode,
    candidateMode:
      latestClassification.answerMode !== 'single'
        ? latestClassification.candidateMode
        : previousClassification.candidateMode,
    rankLimit:
      latestClassification.answerMode !== 'single'
        ? latestClassification.rankLimit
        : previousClassification.rankLimit,
    rankingObjective:
      latestClassification.rankingObjective ??
      previousClassification.rankingObjective,
  })
}

function mergeComparisonConversationContext(input: {
  latestText: string
  latestClassification: RequestClassification
  previousClassification: RequestClassification | null
  previousComparisonContext: NonNullable<
    ReturnType<typeof extractStoredWeatherComparisonContext>
  >
}) {
  const merged = input.previousClassification
    ? mergeConversationContext(
        input.latestText,
        input.latestClassification,
        input.previousClassification,
      )
    : input.latestClassification

  return requestClassificationSchema.parse({
    ...merged,
    taskClass:
      input.previousClassification?.taskClass === 'research' ||
      merged.taskClass === 'research'
        ? 'research'
        : merged.taskClass,
    intent: input.previousComparisonContext.workflow,
    locationRequired:
      input.previousComparisonContext.candidateMode === 'discovered'
        ? false
        : merged.locationRequired,
    answerMode:
      input.latestClassification.answerMode !== 'single'
        ? input.latestClassification.answerMode
        : input.previousComparisonContext.answerMode,
    candidateMode:
      input.latestClassification.answerMode !== 'single'
        ? input.latestClassification.candidateMode
        : input.previousComparisonContext.candidateMode,
    rankLimit:
      input.latestClassification.answerMode !== 'single'
        ? input.latestClassification.rankLimit
        : input.previousComparisonContext.rankLimit,
    rankingObjective:
      input.latestClassification.rankingObjective ??
      input.previousComparisonContext.rankingObjective,
  })
}

export function classifyConversationRequest(messages: Array<any>) {
  const latestUserIndex = latestUserMessageIndex(messages)
  if (latestUserIndex === -1) {
    return classifyRequest('')
  }

  const latestText = extractMessageText(messages[latestUserIndex]).trim()
  const latestClassification = classifyRequest(latestText)
  const normalized = normalizeClassificationInput(latestText)
  const locationOnlyRefinement = isLocationOnlyWeatherRefinement(normalized)
  const previousClassification = previousExplicitUserClassification(
    messages,
    latestUserIndex,
  )
  const previousComparisonContext = extractStoredWeatherComparisonContext(messages)
  const comparisonFollowUp =
    previousComparisonContext != null &&
    (latestClassification.answerMode !== 'single' ||
      (locationOnlyRefinement &&
        previousComparisonContext.candidateMode === 'discovered') ||
      isComparisonFollowUpMessage(normalized) ||
      previousComparisonContext.candidates.some((candidate) =>
        candidateMentionedInQuestion(latestText, candidate),
      ))

  if (comparisonFollowUp && previousComparisonContext) {
    return mergeComparisonConversationContext({
      latestText: normalized,
      latestClassification,
      previousClassification,
      previousComparisonContext,
    })
  }

  if (
    previousClassification &&
    latestClassification.intent === 'current-conditions' &&
    (isConversationFollowUp(normalized) || locationOnlyRefinement)
  ) {
    return mergeConversationContext(
      normalized,
      latestClassification,
      previousClassification,
    )
  }

  if (
    previousClassification &&
    isConversationFollowUp(normalized) &&
    !includesAny(normalized, coreWeatherTerms)
  ) {
    return mergeConversationContext(
      normalized,
      latestClassification,
      previousClassification,
    )
  }

  return requestClassificationSchema.parse({
    ...latestClassification,
    needsArtifact:
      latestClassification.needsArtifact ||
      includesAny(normalized, artifactTerms),
  })
}

export function classifyRequest(message: string): RequestClassification {
  const normalized = normalizeClassificationInput(message)
  const timeHorizonHours = inferTimeHorizonHours(normalized)
  const artifactRequested = includesAny(normalized, artifactTerms)
  const discoveryRanking = isDiscoveryRankingPrompt(normalized)
  const beachRanking = discoveryRanking && includesAny(normalized, beachTerms)
  const broadStormLocator =
    includesAny(normalized, broadStormLocatorTerms) ||
    isBroadStormSpotterPrompt(normalized) ||
    isBroadStormInterestPrompt(normalized) ||
    ((normalized.includes('where are') || normalized.includes('where will')) &&
      includesSevereSignal(normalized))
  const modelDrivenStormAnalysis =
    broadStormLocator && includesAny(normalized, genericModelTerms)

  if (modelDrivenStormAnalysis) {
    return buildClassification('weather-analysis', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      locationRequired: false,
      needsArtifact: artifactRequested,
      answerMode: 'single',
      candidateMode: 'named',
      rankLimit: 1,
      rankingObjective: undefined,
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
      needsArtifact: artifactRequested,
    })
  }

  if (includesAny(normalized, radarTerms)) {
    return buildClassification(
      includesAny(normalized, researchTerms) ||
        includesAny(normalized, artifactTerms)
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

  if (isComparisonPrompt(normalized) && hasMultipleModelMentions(normalized)) {
    if (includesAny(normalized, globalModelTerms) || timeHorizonHours > 48) {
      return buildClassification('global-model', normalized, {
        taskClass: 'research',
        timeHorizonHours,
        needsArtifact: artifactRequested,
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
        rankingObjective: undefined,
      })
    }

    return buildClassification('short-range-model', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      needsArtifact: artifactRequested,
      answerMode: 'single',
      candidateMode: 'named',
      rankLimit: 1,
      rankingObjective: undefined,
    })
  }

  if (includesAny(normalized, genericModelTerms)) {
    if (includesAny(normalized, globalModelTerms) || timeHorizonHours > 48) {
      return buildClassification('global-model', normalized, {
        taskClass: 'research',
        timeHorizonHours,
        needsArtifact: artifactRequested,
        answerMode: 'single',
        candidateMode: 'named',
        rankLimit: 1,
        rankingObjective: undefined,
      })
    }

    return buildClassification('short-range-model', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      needsArtifact: artifactRequested,
      answerMode: 'single',
      candidateMode: 'named',
      rankLimit: 1,
      rankingObjective: undefined,
    })
  }

  const severeShortRangeAnalysis =
    includesAny(normalized, shortRangeModelTerms) &&
    includesSevereSignal(normalized)

  if (severeShortRangeAnalysis) {
    return buildClassification('severe-weather', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      locationRequired: !broadStormLocator,
      needsArtifact: artifactRequested,
    })
  }

  if (includesAny(normalized, blendAnalysisTerms)) {
    return buildClassification('blend-analysis', normalized, {
      needsArtifact: artifactRequested,
    })
  }

  if (includesAny(normalized, shortRangeModelTerms)) {
    return buildClassification('short-range-model', normalized, {
      taskClass: hasMultipleModelMentions(normalized) ? 'research' : 'chat',
      needsArtifact: artifactRequested,
    })
  }

  if (includesAny(normalized, globalModelTerms)) {
    return buildClassification('global-model', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      needsArtifact: artifactRequested,
    })
  }

  if (includesAny(normalized, winterTerms)) {
    return buildClassification('winter-weather', normalized)
  }

  if (includesAny(normalized, precipitationTerms)) {
    return buildClassification('precipitation', normalized, {
      taskClass: 'research',
      needsArtifact: artifactRequested,
    })
  }

  if (includesSevereSignal(normalized) || broadStormLocator) {
    return buildClassification('severe-weather', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      locationRequired: !broadStormLocator,
      needsArtifact: artifactRequested,
    })
  }

  if (includesChaseSignal(normalized)) {
    return buildClassification('severe-weather', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      locationRequired: true,
      needsArtifact: artifactRequested,
    })
  }

  if (includesAny(normalized, alertTerms)) {
    return buildClassification('alerts', normalized, {
      timeHorizonHours: 12,
      needsArtifact: artifactRequested,
    })
  }

  if (
    hasNamedCandidateSeparator(normalized) &&
    includesAny(normalized, ['storm', 'storms', 'tornado', 'supercell'])
  ) {
    return buildClassification('severe-weather', normalized, {
      taskClass: 'research',
      timeHorizonHours,
      locationRequired: true,
      needsArtifact: artifactRequested,
    })
  }

  if (beachRanking) {
    return buildClassification('forecast', normalized, {
      timeHorizonHours,
      locationRequired: false,
      needsArtifact: artifactRequested,
      answerMode: 'rank',
      candidateMode: 'discovered',
      rankLimit: inferRankLimit(normalized, 'rank'),
      rankingObjective: 'beach-day',
    })
  }

  if (includesAny(normalized, [...researchTerms, 'weather analysis'])) {
    return buildClassification('weather-analysis', normalized, {
      taskClass: 'research',
      needsArtifact: artifactRequested,
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
      locationRequired: discoveryRanking ? false : true,
      needsArtifact: artifactRequested,
      answerMode: discoveryRanking ? 'rank' : undefined,
      candidateMode: discoveryRanking ? 'discovered' : undefined,
      rankLimit: discoveryRanking ? inferRankLimit(normalized, 'rank') : undefined,
      rankingObjective: discoveryRanking ? 'pleasant-weather' : undefined,
    })
  }

  return buildClassification('current-conditions', normalized, {
    taskClass: 'chat',
    needsArtifact: artifactRequested,
    timeHorizonHours: 6,
  })
}
