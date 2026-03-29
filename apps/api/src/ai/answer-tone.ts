import type { AnswerTone, RequestClassification } from '@raincheck/contracts'

const casualPhraseReplacements: Array<[RegExp, string]> = [
  [/\bensemble spread\b/gi, 'model disagreement'],
  [/\bhazard framing\b/gi, 'hazard outlook'],
  [/\bsynoptic\b/gi, 'large-scale'],
  [/\bmesoscale details\b/gi, 'small setup details'],
  [/\bmesoscale\b/gi, 'storm-scale'],
  [/\bconvective initiation\b/gi, 'storm development'],
  [/\bconvective\b/gi, 'thunderstorm'],
  [/\bdiscrete storms\b/gi, 'separate storms'],
  [/\bupscale growth\b/gi, 'storms merging together'],
  [/\binitiation\b/gi, 'storm development'],
  [/\bofficial severe context\b/gi, 'official severe outlooks'],
  [/\bsearch region\b/gi, 'search area'],
  [/\bcandidate evidence\b/gi, 'information for each option'],
  [/\bcandidate\b/gi, 'option'],
  [/\bweighted\b/gi, 'looked at'],
]

function normalizeSpacing(value: string) {
  return value
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .trim()
}

function matchReplacementCase(match: string, replacement: string) {
  if (/^[A-Z][^A-Z]/.test(match)) {
    return replacement.charAt(0).toUpperCase() + replacement.slice(1)
  }

  if (match === match.toUpperCase()) {
    return replacement.toUpperCase()
  }

  return replacement
}

export function resolveAnswerTone(value: unknown): AnswerTone {
  return value === 'professional' ? 'professional' : 'casual'
}

export function applyAnswerToneToText(text: string, answerTone: AnswerTone) {
  if (answerTone === 'professional') {
    return normalizeSpacing(text)
  }

  let output = text
  for (const [pattern, replacement] of casualPhraseReplacements) {
    output = output.replace(pattern, (match) =>
      matchReplacementCase(match, replacement),
    )
  }

  return normalizeSpacing(output)
}

export function applyAnswerToneToOptionalText(
  text: string | null | undefined,
  answerTone: AnswerTone,
) {
  if (typeof text !== 'string') {
    return text ?? undefined
  }

  return applyAnswerToneToText(text, answerTone)
}

export function buildSevereWeatherLimitationText(
  classification: RequestClassification,
  answerTone: AnswerTone,
) {
  if (answerTone === 'professional') {
    switch (classification.chaseGuidanceLevel) {
      case 'full-route':
        return 'There is not enough live severe-weather evidence yet to support a route-level call. Try again after the next radar or model update.'
      case 'exact-target':
        return 'There is not enough live severe-weather evidence yet to support an exact town or corridor target. Try again after the next radar or model update.'
      case 'general-target':
        return 'There is not enough live severe-weather evidence yet to support a starting corridor. Try again after the next radar or model update.'
      case 'analysis-only':
      default:
        return 'There is not enough live severe-weather evidence yet to support a confident setup call. Try again after the next radar or model update.'
    }
  }

  switch (classification.chaseGuidanceLevel) {
    case 'full-route':
      return "I don't have enough live severe-weather data yet to call a full route. Check back after the next radar or model update."
    case 'exact-target':
      return "I don't have enough live severe-weather data yet to call an exact town or corridor target. Check back after the next radar or model update."
    case 'general-target':
      return "I don't have enough live severe-weather data yet to call a starting corridor. Check back after the next radar or model update."
    case 'analysis-only':
    default:
      return "I don't have enough live severe-weather data yet to make a confident setup call. Check back after the next radar or model update."
  }
}

export function buildComparisonLimitationText(
  classification: RequestClassification,
  answerTone: AnswerTone,
) {
  if (answerTone === 'professional') {
    if (classification.candidateMode === 'discovered') {
      return 'Name a search area or use a saved location, and I can rank the best options there.'
    }

    if (classification.answerMode === 'compare') {
      return 'Name the places you want compared, and I can stack them up.'
    }

    return 'Name the places you want ranked, and I can sort them out.'
  }

  if (classification.candidateMode === 'discovered') {
    return 'Tell me what area to search, like near Chicago or around Lake Michigan, and I can rank the best options there.'
  }

  if (classification.answerMode === 'compare') {
    return 'Tell me which places you want me to compare and I can sort it out.'
  }

  return 'Tell me which places you want ranked and I can sort them out.'
}
