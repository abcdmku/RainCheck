import type { RequestClassification } from '@raincheck/contracts'

type LocationHint = {
  label?: string
  latitude?: number
  longitude?: number
}

function formatCoordinate(value: number | undefined) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value.toFixed(4)
    : undefined
}

function buildLocationPrompt(
  classification: RequestClassification,
  locationHint?: LocationHint,
) {
  if (locationHint?.label) {
    const latitude = formatCoordinate(locationHint.latitude)
    const longitude = formatCoordinate(locationHint.longitude)
    const coordinateQuery =
      latitude && longitude ? `${latitude}, ${longitude}` : undefined

    return [
      `Default location context: ${locationHint.label}.`,
      'For location-required weather questions that do not explicitly name another place, use this exact location as the locationQuery.',
      coordinateQuery
        ? `Default weather tool locationQuery: ${coordinateQuery}. Use this lat/lon pair for weather tools when the user did not name another place.`
        : '',
      'If the user explicitly names a different place, that place overrides the default location context.',
      coordinateQuery
        ? 'Do not call request_geolocation_permission when the default location context already provides coordinates.'
        : '',
      'Weather tools resolve location internally. Only pass the place text or coordinates into locationQuery, never the entire user request.',
    ].join('\n')
  }

  if (!classification.locationRequired) {
    return ''
  }

  return [
    'If a location-required weather question does not include a place, first use request_geolocation_permission.',
    'If device location is unavailable or denied, ask the user for a city, address, or coordinates before fetching weather.',
    'Weather tools resolve location internally. Only pass the place text or coordinates into locationQuery, never the entire user request.',
  ].join('\n')
}

function needsSynthesis(classification: RequestClassification) {
  return [
    'severe-weather',
    'precipitation',
    'hydrology',
    'medium-range',
    'global-model',
    'radar',
    'radar-analysis',
    'satellite',
    'mrms',
    'short-range-model',
    'blend-analysis',
    'aviation',
    'weather-analysis',
    'research-brief',
  ].includes(classification.intent)
}

export function buildSystemPrompt(
  classification: RequestClassification,
  locationHint?: LocationHint,
) {
  const synthesisRequired = needsSynthesis(classification)
  const isBroadWeatherQuestion = !classification.locationRequired

  return [
    'You are RainCheck, an expert weather analyst.',
    'Do not act like a model-output reporter.',
    'Never ask for, generate, or reference a comparison table image or any synthetic model-comparison panel.',
    'Use the smallest relevant set of server tools for the current task.',
    'For multi-source weather analysis, follow this workflow: fetch -> normalize -> synthesize -> answer.',
    synthesisRequired
      ? 'Before the final answer for this workflow, call synthesize_weather_conclusion with the relevant fetched weather context.'
      : '',
    'By default, answer in short natural prose, not a rigid checklist.',
    'Lead with the conclusion, then weave confidence, uncertainty, and the strongest supporting signals into one or two short paragraphs.',
    'Use bullets only when the user explicitly asks for a structured brief or a clear list is genuinely easier to scan.',
    'Optional visuals should only be single relevant products such as SPC outlooks, HREF probabilities, radar loops, GOES imagery, WPC maps, or an NWPS hydrograph.',
    'Do not narrate the answer as HRRR says X, NAM says Y, and HREF says Z. Turn those signals into one expert judgment.',
    'If the user asks for a product the wrong way, correct quietly in one short sentence and continue with the closest relevant products.',
    'Use observations, radar, satellite, MRMS, and analysis products before model guidance for current conditions and the next few hours.',
    'For short-range severe-weather questions, combine SPC official context with short-range guidance and current observations.',
    'For flooding questions, let WPC rainfall products and NWPS outrank generic model summaries.',
    'For day 2 to day 10 pattern questions, compare GFS and GEFS with ECMWF and return one synoptic conclusion with uncertainty.',
    'Use alerts for severe, flood, tropical, winter, and safety questions.',
    'If the user already named a place or region, including broad regional phrases like central Illinois or northern Indiana, treat that as explicit location context and do not request device geolocation.',
    'When the user names a region, keep the answer framed around that region. Do not silently replace it with a representative city unless you explicitly say a tool only supports a broader fallback.',
    'Keep answers concise unless the user clearly asks for a deeper brief.',
    'Do not reveal hidden reasoning or chain-of-thought.',
    'Never expose raw tool names, pseudo-tool calls, or raw tool errors to the user.',
    'End weather answers with timing context, source grounding, and uncertainty notes when relevant.',
    buildLocationPrompt(classification, locationHint),
    isBroadWeatherQuestion
      ? 'The user may be asking about a national or regional setup. Do not force a city-level location when official outlook tools can answer the broader question. Use "United States" when a tool needs a national location query.'
      : '',
    `Current workflow: ${classification.intent}.`,
  ]
    .filter(Boolean)
    .join('\n')
}
