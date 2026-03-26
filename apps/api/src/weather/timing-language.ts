const dayLabelPattern =
  'today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday'

type LocalDateTimeParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: string
}

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, ' ').trim()
}

function canonicalDayLabel(day: string | undefined) {
  if (!day) {
    return ''
  }

  const lower = day.toLowerCase()
  if (lower === 'today' || lower === 'tomorrow') {
    return lower
  }

  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

function withDay(start: string, end: string, day?: string) {
  const label = canonicalDayLabel(day)
  return `${start} to ${end}${label ? ` ${label}` : ''} local time`
}

function afterTime(start: string, day?: string) {
  const label = canonicalDayLabel(day)
  return `after ${start}${label ? ` ${label}` : ''} local time`
}

function replaceAll(
  value: string,
  pattern: RegExp,
  replacer: (match: string, ...captures: Array<string>) => string,
) {
  return value.replace(pattern, (...args) => {
    const [match, ...rest] = args
    const captures = rest.slice(0, Math.max(0, rest.length - 2))
    return replacer(String(match), ...captures.map((value) => String(value)))
  })
}

function parseIsoLocalDateTimeParts(value: string) {
  const match = value.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/,
  )

  if (!match) {
    return null
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute)
  ) {
    return null
  }

  const weekday = new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month - 1, day)))

  return {
    year,
    month,
    day,
    hour,
    minute,
    weekday,
  } satisfies LocalDateTimeParts
}

function formatClockTime(hour: number, minute: number) {
  if (hour === 0 && minute === 0) {
    return 'midnight'
  }

  if (hour === 12 && minute === 0) {
    return 'noon'
  }

  const suffix = hour >= 12 ? 'PM' : 'AM'
  const normalizedHour = hour % 12 || 12

  if (minute === 0) {
    return `${normalizedHour} ${suffix}`
  }

  return `${normalizedHour}:${String(minute).padStart(2, '0')} ${suffix}`
}

export function formatIsoLocalTimeRange(
  startIso: string,
  endIso: string,
  options: {
    includeDay?: boolean
  } = {},
) {
  const start = parseIsoLocalDateTimeParts(startIso)
  const end = parseIsoLocalDateTimeParts(endIso)

  if (!start || !end) {
    return null
  }

  const startTime = formatClockTime(start.hour, start.minute)
  const endTime = formatClockTime(end.hour, end.minute)
  const sameDay =
    start.year === end.year &&
    start.month === end.month &&
    start.day === end.day

  if (sameDay) {
    return options.includeDay
      ? `${startTime} to ${endTime} ${start.weekday} local time`
      : `${startTime} to ${endTime} local time`
  }

  return `${startTime} ${start.weekday} to ${endTime} ${end.weekday} local time`
}

export function normalizeTimingLanguage(value: string) {
  if (!value.trim()) {
    return value
  }

  let normalized = value

  normalized = replaceAll(
    normalized,
    new RegExp(
      `\\bfrom\\s+late[-\\s]+(${dayLabelPattern})\\s+afternoon\\s+onward\\b`,
      'gi',
    ),
    (_match, day) => afterTime('4 PM', day),
  )
  normalized = replaceAll(
    normalized,
    /\bfrom\s+late[-\s]+afternoon\s+onward\b/gi,
    () => afterTime('4 PM'),
  )

  normalized = replaceAll(
    normalized,
    new RegExp(
      `\\blater[-\\s]+(${dayLabelPattern})\\s+afternoon\\s+(?:and|into|to|through)\\s+(?:the\\s+)?evening\\b`,
      'gi',
    ),
    (_match, day) => withDay('3 PM', '10 PM', day),
  )
  normalized = replaceAll(
    normalized,
    new RegExp(
      `\\blate[-\\s]+(${dayLabelPattern})\\s+afternoon\\s+(?:and|into|to|through)\\s+(?:the\\s+)?evening\\b`,
      'gi',
    ),
    (_match, day) => withDay('4 PM', '10 PM', day),
  )
  normalized = replaceAll(
    normalized,
    new RegExp(
      `\\b(${dayLabelPattern})\\s+afternoon\\s+(?:and|into|to|through)\\s+(?:the\\s+)?evening\\b`,
      'gi',
    ),
    (_match, day) => withDay('noon', '10 PM', day),
  )
  normalized = replaceAll(
    normalized,
    /\blater[-\s]+afternoon\s+(?:and|into|to|through)\s+(?:the\s+)?evening\b/gi,
    () => withDay('3 PM', '10 PM'),
  )
  normalized = replaceAll(
    normalized,
    /\blate[-\s]+afternoon\s+(?:and|into|to|through)\s+(?:the\s+)?evening\b/gi,
    () => withDay('4 PM', '10 PM'),
  )
  normalized = replaceAll(
    normalized,
    /\bafternoon\s+(?:and|into|to|through)\s+(?:the\s+)?evening\b/gi,
    () => withDay('noon', '10 PM'),
  )

  normalized = replaceAll(
    normalized,
    new RegExp(
      `\\blate[-\\s]+(${dayLabelPattern})\\s+afternoon\\s+onward\\b`,
      'gi',
    ),
    (_match, day) => afterTime('4 PM', day),
  )
  normalized = replaceAll(
    normalized,
    /\blate[-\s]+afternoon\s+onward\b/gi,
    () => afterTime('4 PM'),
  )
  normalized = replaceAll(
    normalized,
    /\blater\s+in\s+the\s+afternoon\b/gi,
    () => withDay('3 PM', '6 PM'),
  )
  normalized = replaceAll(normalized, /\blate\s+in\s+the\s+afternoon\b/gi, () =>
    withDay('4 PM', '6 PM'),
  )
  normalized = replaceAll(
    normalized,
    /\bearly\s+in\s+the\s+afternoon\b/gi,
    () => withDay('noon', '3 PM'),
  )
  normalized = replaceAll(normalized, /\blater\s+in\s+the\s+day\b/gi, () =>
    withDay('3 PM', '8 PM'),
  )

  normalized = replaceAll(
    normalized,
    new RegExp(`\\blater[-\\s]+(${dayLabelPattern})\\s+afternoon\\b`, 'gi'),
    (_match, day) => withDay('3 PM', '6 PM', day),
  )
  normalized = replaceAll(
    normalized,
    new RegExp(`\\blate[-\\s]+(${dayLabelPattern})\\s+afternoon\\b`, 'gi'),
    (_match, day) => withDay('4 PM', '6 PM', day),
  )
  normalized = replaceAll(
    normalized,
    new RegExp(`\\b(${dayLabelPattern})\\s+afternoon\\b`, 'gi'),
    (_match, day) => withDay('noon', '6 PM', day),
  )
  normalized = replaceAll(normalized, /\blater[-\s]+afternoon\b/gi, () =>
    withDay('3 PM', '6 PM'),
  )
  normalized = replaceAll(normalized, /\blate[-\s]+afternoon\b/gi, () =>
    withDay('4 PM', '6 PM'),
  )
  normalized = replaceAll(normalized, /\bearly[-\s]+afternoon\b/gi, () =>
    withDay('noon', '3 PM'),
  )
  normalized = replaceAll(normalized, /\bthis\s+afternoon\b/gi, () =>
    withDay('noon', '6 PM'),
  )
  normalized = replaceAll(normalized, /\bafternoon\b/gi, () =>
    withDay('noon', '6 PM'),
  )

  normalized = replaceAll(
    normalized,
    new RegExp(`\\blate[-\\s]+(${dayLabelPattern})\\s+morning\\b`, 'gi'),
    (_match, day) => withDay('9 AM', 'noon', day),
  )
  normalized = replaceAll(
    normalized,
    new RegExp(`\\b(${dayLabelPattern})\\s+morning\\b`, 'gi'),
    (_match, day) => withDay('6 AM', 'noon', day),
  )
  normalized = replaceAll(normalized, /\blate\s+in\s+the\s+morning\b/gi, () =>
    withDay('9 AM', 'noon'),
  )
  normalized = replaceAll(normalized, /\bearly\s+in\s+the\s+morning\b/gi, () =>
    withDay('5 AM', '8 AM'),
  )
  normalized = replaceAll(normalized, /\bearly[-\s]+morning\b/gi, () =>
    withDay('5 AM', '8 AM'),
  )
  normalized = replaceAll(normalized, /\blate[-\s]+morning\b/gi, () =>
    withDay('9 AM', 'noon'),
  )
  normalized = replaceAll(normalized, /\bthis\s+morning\b/gi, () =>
    withDay('6 AM', 'noon'),
  )
  normalized = replaceAll(normalized, /\bmorning\b/gi, () =>
    withDay('6 AM', 'noon'),
  )

  normalized = replaceAll(
    normalized,
    new RegExp(`\\blate[-\\s]+(${dayLabelPattern})\\s+evening\\b`, 'gi'),
    (_match, day) => withDay('9 PM', 'midnight', day),
  )
  normalized = replaceAll(
    normalized,
    new RegExp(`\\b(${dayLabelPattern})\\s+evening\\b`, 'gi'),
    (_match, day) => withDay('6 PM', '10 PM', day),
  )
  normalized = replaceAll(
    normalized,
    /\binto\s+the\s+evening\b/gi,
    () => 'until 10 PM local time',
  )
  normalized = replaceAll(
    normalized,
    /\binto\s+evening\b/gi,
    () => 'until 10 PM local time',
  )
  normalized = replaceAll(
    normalized,
    /\bthrough\s+the\s+evening\b/gi,
    () => 'until 10 PM local time',
  )
  normalized = replaceAll(
    normalized,
    /\bthrough\s+evening\b/gi,
    () => 'until 10 PM local time',
  )
  normalized = replaceAll(normalized, /\bearly[-\s]+evening\b/gi, () =>
    withDay('6 PM', '8 PM'),
  )
  normalized = replaceAll(normalized, /\blate[-\s]+evening\b/gi, () =>
    withDay('9 PM', 'midnight'),
  )
  normalized = replaceAll(normalized, /\bthis\s+evening\b/gi, () =>
    withDay('6 PM', '10 PM'),
  )
  normalized = replaceAll(normalized, /\bevening\b/gi, () =>
    withDay('6 PM', '10 PM'),
  )

  normalized = replaceAll(normalized, /\btonight\b/gi, () =>
    withDay('6 PM', 'midnight'),
  )
  normalized = replaceAll(normalized, /\bovernight\b/gi, () =>
    withDay('10 PM', '6 AM'),
  )
  normalized = replaceAll(normalized, /\btomorrow\s+night\b/gi, () =>
    withDay('8 PM', 'midnight', 'tomorrow'),
  )
  normalized = replaceAll(normalized, /\bnight\b/gi, () =>
    withDay('8 PM', 'midnight'),
  )

  return normalizeWhitespace(normalized)
}
