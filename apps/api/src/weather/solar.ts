const degreesToRadians = Math.PI / 180
const radiansToDegrees = 180 / Math.PI

function normalizeAngle(value: number) {
  const normalized = value % 360
  return normalized < 0 ? normalized + 360 : normalized
}

function dayOfYear(year: number, month: number, day: number) {
  const start = Date.UTC(year, 0, 0)
  const current = Date.UTC(year, month - 1, day)
  return Math.floor((current - start) / 86_400_000)
}

function timePartsForZone(value: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  })
  const parts = formatter.formatToParts(value)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))

  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  }
}

function sunEventUtc(input: {
  year: number
  month: number
  day: number
  latitude: number
  longitude: number
  zenith: number
}) {
  const n = dayOfYear(input.year, input.month, input.day)
  const lngHour = input.longitude / 15
  const t = n + (18 - lngHour) / 24
  const meanAnomaly = 0.9856 * t - 3.289
  const trueLongitude = normalizeAngle(
    meanAnomaly +
      1.916 * Math.sin(meanAnomaly * degreesToRadians) +
      0.02 * Math.sin(2 * meanAnomaly * degreesToRadians) +
      282.634,
  )

  let rightAscension =
    radiansToDegrees *
    Math.atan(0.91764 * Math.tan(trueLongitude * degreesToRadians))
  rightAscension = normalizeAngle(rightAscension)

  const trueLongitudeQuadrant = Math.floor(trueLongitude / 90) * 90
  const rightAscensionQuadrant = Math.floor(rightAscension / 90) * 90
  rightAscension =
    (rightAscension + trueLongitudeQuadrant - rightAscensionQuadrant) / 15

  const sinDeclination = 0.39782 * Math.sin(trueLongitude * degreesToRadians)
  const cosDeclination = Math.cos(Math.asin(sinDeclination))
  const cosLocalHourAngle =
    (Math.cos(input.zenith * degreesToRadians) -
      sinDeclination * Math.sin(input.latitude * degreesToRadians)) /
    (cosDeclination * Math.cos(input.latitude * degreesToRadians))

  if (cosLocalHourAngle < -1 || cosLocalHourAngle > 1) {
    return null
  }

  const localHourAngle =
    radiansToDegrees * Math.acos(cosLocalHourAngle) / 15
  const localMeanTime =
    localHourAngle + rightAscension - 0.06571 * t - 6.622
  const utcHours = ((localMeanTime - lngHour) % 24 + 24) % 24
  const wholeHours = Math.floor(utcHours)
  const minutesFloat = (utcHours - wholeHours) * 60
  const wholeMinutes = Math.floor(minutesFloat)
  const seconds = Math.round((minutesFloat - wholeMinutes) * 60)
  const normalizedSeconds = seconds === 60 ? 0 : seconds
  const minuteCarry = seconds === 60 ? 1 : 0

  return new Date(
    Date.UTC(
      input.year,
      input.month - 1,
      input.day,
      wholeHours,
      wholeMinutes + minuteCarry,
      normalizedSeconds,
    ),
  )
}

export function computeNightfall(input: {
  latitude: number
  longitude: number
  timeZone?: string
  referenceTime?: string
}) {
  const reference = input.referenceTime
    ? new Date(input.referenceTime)
    : new Date()
  if (Number.isNaN(reference.getTime())) {
    return null
  }

  const dateParts = input.timeZone
    ? timePartsForZone(reference, input.timeZone)
    : {
        year: reference.getUTCFullYear(),
        month: reference.getUTCMonth() + 1,
        day: reference.getUTCDate(),
      }

  const civilDusk = sunEventUtc({
    ...dateParts,
    latitude: input.latitude,
    longitude: input.longitude,
    zenith: 96,
  })
  if (civilDusk) {
    return {
      event: 'civil-dusk' as const,
      occursAt: civilDusk.toISOString(),
    }
  }

  const sunset = sunEventUtc({
    ...dateParts,
    latitude: input.latitude,
    longitude: input.longitude,
    zenith: 90.833,
  })
  if (!sunset) {
    return null
  }

  return {
    event: 'sunset' as const,
    occursAt: sunset.toISOString(),
  }
}
